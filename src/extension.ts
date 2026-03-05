import * as vscode from 'vscode';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'crypto';
import { 
    CallToolRequestSchema, 
    ListResourcesRequestSchema, 
    ListResourceTemplatesRequestSchema, 
    ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import cors from 'cors';
import type { Server as HttpServer } from 'http';
import { Request, Response } from 'express';
import { mcpTools } from './tools';
import { createDebugPanel } from './debugPanel';
import { mcpServer, httpServer, setMcpServer, setHttpServer } from './globals';
import { runTool } from './toolRunner';
import { findBifrostConfig, BifrostConfig, getProjectBasePath } from './config';

export async function activate(context: vscode.ExtensionContext) {
    let currentConfig: BifrostConfig | null = null;

    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(async () => {
            await restartServerWithConfig();
        })
    );

    await restartServerWithConfig();

    context.subscriptions.push(
        vscode.commands.registerCommand('bifrost-mcp.openDebugPanel', () => {
            createDebugPanel(context);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('bifrost-mcp.startServer', async () => {
            try {
                if (httpServer) {
                    vscode.window.showInformationMessage(`MCP server already running for ${currentConfig?.projectName || 'unknown'}`);
                    return;
                }
                await restartServerWithConfig();
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to start MCP server: ${errorMsg}`);
            }
        }),
        vscode.commands.registerCommand('bifrost-mcp.stopServer', async () => {
            if (!httpServer && !mcpServer) {
                vscode.window.showInformationMessage('No MCP server running');
                return;
            }
            if (mcpServer) {
                mcpServer.close();
                setMcpServer(undefined);
            }
            if (httpServer) {
                httpServer.close();
                setHttpServer(undefined);
            }
            vscode.window.showInformationMessage('MCP server stopped');
        })
    );

    async function restartServerWithConfig() {
        if (mcpServer) {
            mcpServer.close();
            setMcpServer(undefined);
        }
        if (httpServer) {
            httpServer.close();
            setHttpServer(undefined);
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders?.length) {
            console.log('No workspace folder');
            return;
        }

        const config = await findBifrostConfig(workspaceFolders[0]);
        currentConfig = config!;
        await startMcpServer(config!);
    }

    async function startMcpServer(config: BifrostConfig) {
        setMcpServer(new Server(
            { name: config.projectName, version: "0.1.0", description: config.description },
            { capabilities: { tools: {}, resources: {} } }
        ));

        mcpServer!.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: mcpTools }));
        mcpServer!.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));
        mcpServer!.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ templates: [] }));

        mcpServer!.setRequestHandler(CallToolRequestSchema, async (request) => {
            try {
                const { name, arguments: args } = request.params;
                const result = await runTool(name, args);
                return { content: [{ type: "text", text: JSON.stringify(result) }] };
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
            }
        });

        // Handle uncaught errors
        mcpServer!.onerror = (error) => {
            console.error('[MCP Server] Error:', error);
        };

        const app = express();
        
        // Enable CORS - the cors() middleware handles OPTIONS automatically
        app.use(cors({
            origin: true,
            methods: ['GET', 'POST', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
            credentials: false
        }));
        // REMOVED: app.options('*', cors()) - causes Express "Missing parameter name" error
        // The cors middleware above already handles preflight OPTIONS requests

        const basePath = getProjectBasePath(config);

        // Create transport with event handlers
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID()
        });

        transport.onerror = (err: Error) => {
            console.error('[MCP Transport] Error:', err);
        };

        transport.onclose = () => {
            console.log('[MCP Transport] Closed');
        };

        await mcpServer!.connect(transport);

        // MCP endpoints with detailed logging
        app.post(`${basePath}/mcp`, async (req: Request, res: Response) => {
            const requestId = randomUUID().slice(0, 8);
            console.log(`[${requestId}] MCP POST ${new Date().toISOString()}`);
            console.log(`[${requestId}] Content-Type:`, req.headers['content-type']);
            console.log(`[${requestId}] Content-Length:`, req.headers['content-length']);
            
            try {
                await transport.handleRequest(req, res);
                console.log(`[${requestId}] Success`);
            } catch (error) {
                console.error(`[${requestId}] Error:`, error);
                if (!res.headersSent) {
                    res.status(500).json({
                        jsonrpc: "2.0",
                        id: null,
                        error: { code: -32000, message: String(error) }
                    });
                }
            }
        });
        
        app.get(`${basePath}/mcp`, async (req: Request, res: Response) => {
            const requestId = randomUUID().slice(0, 8);
            console.log(`[${requestId}] MCP GET ${new Date().toISOString()}`);
            
            try {
                await transport.handleRequest(req, res);
                console.log(`[${requestId}] Success`);
            } catch (error) {
                console.error(`[${requestId}] Error:`, error);
                if (!res.headersSent) {
                    res.status(500).json({
                        jsonrpc: "2.0",
                        id: null,
                        error: { code: -32000, message: String(error) }
                    });
                }
            }
        });

        // Deprecated endpoints
        app.get(`${basePath}/sse`, async (_req: Request, res: Response) => {
            res.status(410).json({
                status: 'deprecated',
                message: 'Use Streamable HTTP at /mcp',
                newEndpoint: `${basePath}/mcp`
            });
        });

        app.post(`${basePath}/message`, async (_req: Request, res: Response) => {
            res.status(410).json({
                status: 'deprecated',
                message: 'Use Streamable HTTP at /mcp',
                newEndpoint: `${basePath}/mcp`
            });
        });

        // Health check
        app.get(`${basePath}/health`, (_req: Request, res: Response) => {
            res.json({ 
                status: 'ok',
                project: config.projectName,
                transport: 'streamable-http',
                timestamp: new Date().toISOString()
            });
        });

        // Global error handler
        app.use((err: Error, _req: Request, res: Response, _next: any) => {
            console.error('[Express] Unhandled error:', err);
            res.status(500).json({ error: err.message });
        });

        try {
            const serv = app.listen(config.port);
            setHttpServer(serv);
            const url = `http://localhost:${config.port}${basePath}`;
            vscode.window.showInformationMessage(`MCP server: ${url}`);
            console.log(`[Startup] MCP server listening on ${url}`);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to start: ${msg}`);
            throw error;
        }
    }
}

export function deactivate() {
    mcpServer?.close();
    httpServer?.close();
}

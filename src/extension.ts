import * as vscode from 'vscode';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'crypto';
import { 
    CallToolRequestSchema, 
    ListResourcesRequestSchema, 
    ListResourceTemplatesRequestSchema, 
    ListToolsRequestSchema,
    McpError,
    ErrorCode
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

        // Handle uncaught errors from the MCP server
        mcpServer!.onerror = (error) => {
            console.error('MCP Server error:', error);
        };

        const app = express();
        
        // Enable CORS with specific configuration for MCP
        app.use(cors({
            origin: '*',
            methods: ['GET', 'POST', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
            credentials: true
        }));

        const basePath = getProjectBasePath(config);

        // Create transport
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID()
        });

        // Connection handling
        transport.onerror = (err) => {
            console.error('Transport error:', err);
        };

        transport.onclose = () => {
            console.log('Transport closed');
        };

        transport.onconnection = (connection) => {
            console.log('New connection established');
            connection.onerror = (err) => {
                console.error('Connection error:', err);
            };
        };

        await mcpServer!.connect(transport);

        // Wrap transport handler with logging
        app.post(`${basePath}/mcp`, async (req: Request, res: Response) => {
            console.log(`[MCP POST] ${new Date().toISOString()}`);
            console.log('Headers:', JSON.stringify(req.headers));
            
            try {
                await transport.handleRequest(req, res);
                console.log('[MCP POST] Handled successfully');
            } catch (error) {
                console.error('[MCP POST] Error:', error);
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
            console.log(`[MCP GET] ${new Date().toISOString()}`);
            
            try {
                await transport.handleRequest(req, res);
                console.log('[MCP GET] Handled successfully');
            } catch (error) {
                console.error('[MCP GET] Error:', error);
                if (!res.headersSent) {
                    res.status(500).json({
                        jsonrpc: "2.0",
                        id: null,
                        error: { code: -32000, message: String(error) }
                    });
                }
            }
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

        try {
            const serv = app.listen(config.port);
            setHttpServer(serv);
            const url = `http://localhost:${config.port}${basePath}`;
            vscode.window.showInformationMessage(`MCP server: ${url}`);
            console.log(`MCP server listening on ${url}`);
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
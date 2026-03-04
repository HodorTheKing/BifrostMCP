import * as vscode from 'vscode';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node/streamable-http.js';
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

    // Handle workspace folder changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(async () => {
            await restartServerWithConfig();
        })
    );

    // Initial server start with config
    await restartServerWithConfig();

    // Register debug panel command
    context.subscriptions.push(
        vscode.commands.registerCommand('bifrost-mcp.openDebugPanel', () => {
            createDebugPanel(context);
        })
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('bifrost-mcp.startServer', async () => {
            try {
                if (httpServer) {
                    vscode.window.showInformationMessage(`MCP server is already running for project ${currentConfig?.projectName || 'unknown'}`);
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
                vscode.window.showInformationMessage('No MCP server is currently running');
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
        // Stop existing server if running
        if (mcpServer) {
            mcpServer.close();
            setMcpServer(undefined);
        }
        if (httpServer) {
            httpServer.close();
            setHttpServer(undefined);
        }

        // Get workspace folder
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            console.log('No workspace folder found');
            return;
        }

        // Find config in current workspace - will return DEFAULT_CONFIG if none found
        const config = await findBifrostConfig(workspaceFolders[0]);
        currentConfig = config!; // We know this is never null since findBifrostConfig always returns DEFAULT_CONFIG
        await startMcpServer(config!);
    }

    async function startMcpServer(config: BifrostConfig): Promise<{ mcpServer: Server, httpServer: HttpServer, port: number }> {
        // Create an MCP Server with project-specific info
        setMcpServer(new Server(
            {
                name: config.projectName,
                version: "0.1.0",
                description: config.description
            },
            {
                capabilities: {
                    tools: {},
                    resources: {},
                }
            }
        ));

        // Add tools handlers
        mcpServer!.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: mcpTools
        }));

        mcpServer!.setRequestHandler(ListResourcesRequestSchema, async () => ({
            resources: []
        }));

        mcpServer!.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
            templates: []
        }));

        // Add call tool handler
        mcpServer!.setRequestHandler(CallToolRequestSchema, async (request) => {
            try {
                const { name, arguments: args } = request.params;
                let result: any;
                
                // Verify file exists for commands that require it
                if (args && typeof args === 'object' && 'textDocument' in args && 
                    args.textDocument && typeof args.textDocument === 'object' && 
                    'uri' in args.textDocument && typeof args.textDocument.uri === 'string') {
                    const uri = vscode.Uri.parse(args.textDocument.uri);
                    try {
                        await vscode.workspace.fs.stat(uri);
                    } catch (error) {
                        return {
                            content: [{ 
                                type: "text", 
                                text: `Error: File not found - ${uri.fsPath}` 
                            }],
                            isError: true
                        };
                    }
                }
                
                result = await runTool(name, args);

                return { content: [{ type: "text", text: JSON.stringify(result) }] };
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    content: [{ type: "text", text: `Error: ${errorMessage}` }],
                    isError: true,
                };
            }
        });

        // Set up Express app
        const app = express();
        app.use(cors());
        app.use(express.json());

        const basePath = getProjectBasePath(config);

        // Create Streamable HTTP transport with session management
        const transport = new NodeStreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID()
        });

        // Connect MCP server to transport
        await mcpServer!.connect(transport);

        // Single MCP endpoint that handles POST requests
        app.post(`${basePath}/mcp`, async (req: Request, res: Response) => {
            console.log(`Received MCP POST request for project ${config.projectName}`);
            
            try {
                await transport.handleRequest(req, res, req.body);
                console.log('MCP POST handled successfully');
            } catch (error) {
                console.error('Error handling MCP POST:', error);
                res.status(500).json({
                    jsonrpc: "2.0",
                    id: req.body?.id,
                    error: {
                        code: -32000,
                        message: String(error)
                    }
                });
            }
        });

        // SSE endpoint for backwards compatibility with MCP clients
        // that use the older SSE transport - returns 410 Gone
        app.get(`${basePath}/sse`, async (_req: Request, res: Response) => {
            console.log(`SSE connection attempt (deprecated transport) for project ${config.projectName}`);
            console.log(`Consider migrating to Streamable HTTP at ${basePath}/mcp`);
            
            res.status(410).json({
                status: 'deprecated',
                message: 'SSE transport is deprecated. Use Streamable HTTP at /mcp',
                newEndpoint: `${basePath}/mcp`
            });
        });

        // Message endpoint (also deprecated) - returns 410 Gone
        app.post(`${basePath}/message`, async (_req: Request, res: Response) => {
            console.log(`Message POST received (deprecated transport) for project ${config.projectName}`);
            
            res.status(410).json({
                status: 'deprecated',
                message: 'Message endpoint is deprecated. Use Streamable HTTP at /mcp',
                newEndpoint: `${basePath}/mcp`
            });
        });

        // Health check endpoint with migration info
        app.get(`${basePath}/health`, (_req: Request, res: Response) => {
            res.status(200).json({ 
                status: 'ok',
                project: config.projectName,
                description: config.description,
                transport: 'streamable-http',
                endpoints: {
                    mcp: `${basePath}/mcp`,
                    deprecated: [
                        `${basePath}/sse`,
                        `${basePath}/message`
                    ]
                },
                migration: 'Configure your client to use Streamable HTTP transport instead of SSE'
            });
        });

        try {
            const serv = app.listen(config.port);
            setHttpServer(serv);
            const serverUrl = basePath === '' ? `http://localhost:${config.port}` : `http://localhost:${config.port}${basePath}`;
            vscode.window.showInformationMessage(`MCP server (Streamable HTTP) listening on ${serverUrl}`);
            console.log(`MCP Server for project ${config.projectName} listening on ${serverUrl}`);
            console.log(`MCP endpoint: ${basePath}/mcp`);
            return {
                mcpServer: mcpServer!,
                httpServer: httpServer!,
                port: config.port
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to start server on configured port ${config.port}${basePath}. Please check if the port is available or configure a different port in bifrost.config.json. Error: ${errorMsg}`);
            throw new Error(`Failed to start server on configured port ${config.port}. Please check if the port is available or configure a different port in bifrost.config.json. Error: ${errorMsg}`);
        }
    }
}

export function deactivate() {
    if (mcpServer) {
        mcpServer.close();
    }
    if (httpServer) {
        httpServer.close();
    }
}

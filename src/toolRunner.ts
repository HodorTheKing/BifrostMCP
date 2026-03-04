import * as vscode from 'vscode';
import * as path from 'path';
import { createVscodePosition, getPreview, convertSymbol, asyncMap, convertSemanticTokens, getSymbolKindString, transformLocations, transformSingleLocation } from './helpers';
import { ReferencesAndPreview, RenameEdit } from './rosyln';
import { mcpTools } from './tools';

const toolNames = mcpTools.map((tool) => tool.name);

// Helper functions for file operations (from vscode-mcp-server)
async function listWorkspaceFiles(workspacePath: string, recursive: boolean = false): Promise<Array<{path: string, type: 'file' | 'directory'}>> {
    if (!vscode.workspace.workspaceFolders) {
        throw new Error('No workspace folder is open');
    }
    const workspaceFolder = vscode.workspace.workspaceFolders[0];
    const workspaceUri = workspaceFolder.uri;
    const targetUri = vscode.Uri.joinPath(workspaceUri, workspacePath);

    async function processDirectory(dirUri: vscode.Uri, currentPath: string = ''): Promise<Array<{path: string, type: 'file' | 'directory'}>> {
        const entries = await vscode.workspace.fs.readDirectory(dirUri);
        const result: Array<{path: string, type: 'file' | 'directory'}> = [];
        for (const [name, type] of entries) {
            const entryPath = currentPath ? path.join(currentPath, name) : name;
            const itemType: 'file' | 'directory' = (type & vscode.FileType.Directory) ? 'directory' : 'file';
            result.push({ path: entryPath, type: itemType });
            if (recursive && itemType === 'directory') {
                const subDirUri = vscode.Uri.joinPath(dirUri, name);
                const subEntries = await processDirectory(subDirUri, entryPath);
                result.push(...subEntries);
            }
        }
        return result;
    }
    return processDirectory(targetUri);
}

async function readWorkspaceFile(workspacePath: string, encoding: string = 'utf-8', maxCharacters: number = 100000, startLine: number = -1, endLine: number = -1): Promise<string> {
    if (!vscode.workspace.workspaceFolders) {
        throw new Error('No workspace folder is open');
    }
    const workspaceFolder = vscode.workspace.workspaceFolders[0];
    const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, workspacePath);
    const fileContent = await vscode.workspace.fs.readFile(fileUri);

    if (encoding === 'base64') {
        if (fileContent.byteLength > maxCharacters) throw new Error(`File exceeds limit`);
        return Buffer.from(fileContent).toString('base64');
    } else {
        const textDecoder = new TextDecoder(encoding);
        const textContent = textDecoder.decode(fileContent);
        if (textContent.length > maxCharacters) throw new Error(`File exceeds limit`);
        if (startLine >= 0 || endLine >= 0) {
            const lines = textContent.split('\n');
            return lines.slice(startLine >= 0 ? startLine : 0, endLine >= 0 ? endLine + 1 : lines.length).join('\n');
        }
        return textContent;
    }
}

async function createWorkspaceFile(workspacePath: string, content: string, overwrite: boolean = false, ignoreIfExists: boolean = false): Promise<void> {
    if (!vscode.workspace.workspaceFolders) throw new Error('No workspace folder is open');
    const workspaceFolder = vscode.workspace.workspaceFolders[0];
    const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, workspacePath);
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.createFile(fileUri, { contents: new TextEncoder().encode(content), overwrite, ignoreIfExists });
    const success = await vscode.workspace.applyEdit(workspaceEdit);
    if (success) {
        const document = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(document);
    } else {
        throw new Error(`Failed to create file`);
    }
}

async function replaceWorkspaceFileLines(workspacePath: string, startLine: number, endLine: number, content: string, originalCode: string): Promise<void> {
    if (!vscode.workspace.workspaceFolders) throw new Error('No workspace folder is open');
    const workspaceFolder = vscode.workspace.workspaceFolders[0];
    const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, workspacePath);
    const document = await vscode.workspace.openTextDocument(fileUri);

    if (startLine < 0 || startLine >= document.lineCount) throw new Error(`Start line out of range`);
    if (endLine < startLine || endLine >= document.lineCount) throw new Error(`End line out of range`);

    const currentLines = [];
    for (let i = startLine; i <= endLine; i++) currentLines.push(document.lineAt(i).text);
    if (currentLines.join('\n') !== originalCode) throw new Error(`Original code validation failed`);

    const range = new vscode.Range(new vscode.Position(startLine, 0), new vscode.Position(endLine, document.lineAt(endLine).text.length));
    let editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== fileUri.toString()) editor = await vscode.window.showTextDocument(document);

    const success = await editor.edit((editBuilder) => editBuilder.replace(range, content));
    if (success) await document.save();
    else throw new Error(`Failed to replace lines`);
}

export const runTool = async (name: string, args: any) => {
    if (!toolNames.includes(name)) throw new Error(`Unknown tool: ${name}`);

    // === NEW: vscode-mcp-server tools (no textDocument required) ===
    if (name === 'list_files_code') {
        const files = await listWorkspaceFiles(args?.path || '.', args?.recursive || false);
        return { content: [{ type: "text", text: JSON.stringify(files, null, 2) }] };
    }

    if (name === 'execute_shell_command_code') {
        const terminal = vscode.window.createTerminal('MCP Shell');
        terminal.show();
        terminal.sendText(args?.command || '');
        return { content: [{ type: "text", text: `Command sent: ${args?.command}` }] };
    }

    if (name === 'read_file_code') {
        if (!vscode.workspace.workspaceFolders) return { content: [{ type: "text", text: "No workspace open" }], isError: true };
        const content = await readWorkspaceFile(args?.path, args?.encoding || 'utf-8', args?.maxCharacters || 100000,
            args?.startLine > 0 ? args.startLine - 1 : -1, args?.endLine > 0 ? args.endLine - 1 : -1);
        return { content: [{ type: "text", text: content }] };
    }

    if (name === 'create_file_code') {
        if (!vscode.workspace.workspaceFolders) return { content: [{ type: "text", text: "No workspace open" }], isError: true };
        await createWorkspaceFile(args?.path, args?.content || '', args?.overwrite || false, args?.ignoreIfExists || false);
        return { content: [{ type: "text", text: `File created: ${args?.path}` }] };
    }

    if (name === 'replace_lines_code') {
        if (!vscode.workspace.workspaceFolders) return { content: [{ type: "text", text: "No workspace open" }], isError: true };
        await replaceWorkspaceFileLines(args?.path, args?.startLine > 0 ? args.startLine - 1 : 0, args?.endLine > 0 ? args.endLine - 1 : 0, args?.content || '', args?.originalCode || '');
        return { content: [{ type: "text", text: `Replaced lines ${args?.startLine}-${args?.endLine}` }] };
    }

    if (name === 'move_file_code') {
        if (!vscode.workspace.workspaceFolders) return { content: [{ type: "text", text: "No workspace open" }], isError: true };
        const workspaceFolder = vscode.workspace.workspaceFolders[0];
        const edit = new vscode.WorkspaceEdit();
        edit.renameFile(vscode.Uri.joinPath(workspaceFolder.uri, args?.sourcePath), vscode.Uri.joinPath(workspaceFolder.uri, args?.targetPath), { overwrite: args?.overwrite || false });
        const success = await vscode.workspace.applyEdit(edit);
        return { content: [{ type: "text", text: success ? `Moved ${args?.sourcePath} to ${args?.targetPath}` : "Move failed" }] };
    }

    if (name === 'rename_file_code') {
        if (!vscode.workspace.workspaceFolders) return { content: [{ type: "text", text: "No workspace open" }], isError: true };
        const workspaceFolder = vscode.workspace.workspaceFolders[0];
        const edit = new vscode.WorkspaceEdit();
        const directoryPath = path.dirname(args?.filePath);
        const newFilePath = path.join(directoryPath, args?.newName);
        edit.renameFile(vscode.Uri.joinPath(workspaceFolder.uri, args?.filePath), vscode.Uri.joinPath(workspaceFolder.uri, newFilePath), { overwrite: args?.overwrite || false });
        const success = await vscode.workspace.applyEdit(edit);
        return { content: [{ type: "text", text: success ? `Renamed to ${args?.newName}` : "Rename failed" }] };
    }

    if (name === 'copy_file_code') {
        if (!vscode.workspace.workspaceFolders) return { content: [{ type: "text", text: "No workspace open" }], isError: true };
        const workspaceFolder = vscode.workspace.workspaceFolders[0];
        const sourceUri = vscode.Uri.joinPath(workspaceFolder.uri, args?.sourcePath);
        const targetUri = vscode.Uri.joinPath(workspaceFolder.uri, args?.targetPath);
        const fileContent = await vscode.workspace.fs.readFile(sourceUri);
        await vscode.workspace.fs.writeFile(targetUri, fileContent);
        return { content: [{ type: "text", text: `Copied to ${args?.targetPath}` }] };
    }

    // === ORIGINAL: Bifrost tools (require textDocument) ===
    const uri = vscode.Uri.parse(args?.textDocument?.uri ?? '');
    try {
        await vscode.workspace.fs.stat(uri);
    } catch (error) {
        return { content: [{ type: "text", text: `Error: File not found - ${uri.fsPath}` }], isError: true };
    }

    const position = args?.position ? createVscodePosition(args.position.line, args.position.character) : undefined;
    let result: any;

    switch (name) {
        case "find_usages": {
            const locations = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', uri, position);
            result = locations ? await asyncMap(locations, transformSingleLocation) : [];
            break;
        }
        case "go_to_definition":
            result = await transformLocations(await vscode.commands.executeCommand('vscode.executeDefinitionProvider', uri, position));
            break;
        case "find_implementations":
            result = await transformLocations(await vscode.commands.executeCommand('vscode.executeImplementationProvider', uri, position));
            break;
        case "get_hover_info": {
            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, position);
            result = await asyncMap(hovers || [], async (hover) => ({
                contents: hover.contents.map(c => typeof c === 'string' ? c : c.value),
                range: hover.range ? { start: { line: hover.range.start.line, character: hover.range.start.character }, end: { line: hover.range.end.line, character: hover.range.end.character } } : undefined,
                preview: await getPreview(uri, hover.range?.start.line)
            }));
            break;
        }
        case "get_document_symbols":
            result = (await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', uri))?.map(convertSymbol);
            break;
        default:
            throw new Error(`Tool not implemented: ${name}`);
    }
    return result;
};
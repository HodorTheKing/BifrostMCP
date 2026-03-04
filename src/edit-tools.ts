import * as vscode from 'vscode';

/**
 * Creates a new file in the VS Code workspace using WorkspaceEdit
 */
export async function createWorkspaceFile(
    workspacePath: string,
    content: string,
    overwrite: boolean = false,
    ignoreIfExists: boolean = false
): Promise<void> {
    if (!vscode.workspace.workspaceFolders) {
        throw new Error('No workspace folder is open');
    }

    const workspaceFolder = vscode.workspace.workspaceFolders[0];
    const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, workspacePath);
    
    const workspaceEdit = new vscode.WorkspaceEdit();
    const contentBuffer = new TextEncoder().encode(content);
    
    workspaceEdit.createFile(fileUri, {
        contents: contentBuffer,
        overwrite: overwrite,
        ignoreIfExists: ignoreIfExists
    });
    
    const success = await vscode.workspace.applyEdit(workspaceEdit);
    
    if (success) {
        const document = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(document);
    } else {
        throw new Error(`Failed to create file: ${fileUri.fsPath}`);
    }
}

/**
 * Replaces specific lines in a file in the VS Code workspace
 */
export async function replaceWorkspaceFileLines(
    workspacePath: string,
    startLine: number,
    endLine: number,
    content: string,
    originalCode: string
): Promise<void> {
    if (!vscode.workspace.workspaceFolders) {
        throw new Error('No workspace folder is open');
    }

    const workspaceFolder = vscode.workspace.workspaceFolders[0];
    const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, workspacePath);
    
    const document = await vscode.workspace.openTextDocument(fileUri);
    
    if (startLine < 0 || startLine >= document.lineCount) {
        throw new Error(`Start line ${startLine + 1} is out of range (1-${document.lineCount})`);
    }
    if (endLine < startLine || endLine >= document.lineCount) {
        throw new Error(`End line ${endLine + 1} is out of range (${startLine + 1}-${document.lineCount})`);
    }
    
    const currentLines = [];
    for (let i = startLine; i <= endLine; i++) {
        currentLines.push(document.lineAt(i).text);
    }
    const currentContent = currentLines.join('\n');
    
    if (currentContent !== originalCode) {
        throw new Error('Original code validation failed. Current content does not match.');
    }
    
    const startPos = new vscode.Position(startLine, 0);
    const endPos = new vscode.Position(endLine, document.lineAt(endLine).text.length);
    const range = new vscode.Range(startPos, endPos);
    
    let editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== fileUri.toString()) {
        editor = await vscode.window.showTextDocument(document);
    }
    
    const success = await editor.edit((editBuilder) => {
        editBuilder.replace(range, content);
    });
    
    if (success) {
        await document.save();
    } else {
        throw new Error(`Failed to replace lines`);
    }
}

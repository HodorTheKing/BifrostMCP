import * as vscode from 'vscode';
import * as path from 'path';

// Type for file listing results
export type FileListingResult = Array<{path: string, type: 'file' | 'directory'}>;

// Default maximum character count
const DEFAULT_MAX_CHARACTERS = 100000;

/**
 * Lists files and directories in the VS Code workspace
 */
export async function listWorkspaceFiles(workspacePath: string, recursive: boolean = false): Promise<FileListingResult> {
    console.log(`[listWorkspaceFiles] Starting with path: ${workspacePath}, recursive: ${recursive}`);
    
    if (!vscode.workspace.workspaceFolders) {
        throw new Error('No workspace folder is open');
    }

    const workspaceFolder = vscode.workspace.workspaceFolders[0];
    const workspaceUri = workspaceFolder.uri;
    const targetUri = vscode.Uri.joinPath(workspaceUri, workspacePath);

    async function processDirectory(dirUri: vscode.Uri, currentPath: string = ''): Promise<FileListingResult> {
        const entries = await vscode.workspace.fs.readDirectory(dirUri);
        const result: FileListingResult = [];

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

/**
 * Reads a file from the VS Code workspace with character limit check
 */
export async function readWorkspaceFile(
    workspacePath: string, 
    encoding: string = 'utf-8', 
    maxCharacters: number = DEFAULT_MAX_CHARACTERS,
    startLine: number = -1,
    endLine: number = -1
): Promise<string> {
    if (!vscode.workspace.workspaceFolders) {
        throw new Error('No workspace folder is open');
    }

    const workspaceFolder = vscode.workspace.workspaceFolders[0];
    const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, workspacePath);
    const fileContent = await vscode.workspace.fs.readFile(fileUri);
    
    if (encoding === 'base64') {
        if (fileContent.byteLength > maxCharacters) {
            throw new Error(`File exceeds max character limit (${fileContent.byteLength} vs ${maxCharacters})`);
        }
        return Buffer.from(fileContent).toString('base64');
    } else {
        const textDecoder = new TextDecoder(encoding);
        const textContent = textDecoder.decode(fileContent);
        
        if (textContent.length > maxCharacters) {
            throw new Error(`File exceeds max character limit (${textContent.length} vs ${maxCharacters})`);
        }
        
        if (startLine >= 0 || endLine >= 0) {
            const lines = textContent.split('\n');
            const effectiveStartLine = startLine >= 0 ? startLine : 0;
            const effectiveEndLine = endLine >= 0 ? Math.min(endLine, lines.length - 1) : lines.length - 1;
            
            if (effectiveStartLine >= lines.length) {
                throw new Error(`Start line ${effectiveStartLine + 1} is out of range (1-${lines.length})`);
            }
            
            if (effectiveEndLine < effectiveStartLine) {
                throw new Error(`End line ${effectiveEndLine + 1} is less than start line ${effectiveStartLine + 1}`);
            }
            
            return lines.slice(effectiveStartLine, effectiveEndLine + 1).join('\n');
        }
        
        return textContent;
    }
}

/**
 * Moves a file or directory to a new location
 */
export async function moveWorkspaceFile(
    sourcePath: string,
    targetPath: string,
    overwrite: boolean = false
): Promise<boolean> {
    if (!vscode.workspace.workspaceFolders) {
        throw new Error('No workspace folder is open');
    }

    const workspaceFolder = vscode.workspace.workspaceFolders[0].uri;
    const sourceUri = vscode.Uri.joinPath(workspaceFolder, sourcePath);
    const targetUri = vscode.Uri.joinPath(workspaceFolder, targetPath);

    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(sourceUri, targetUri, { overwrite });

    const success = await vscode.workspace.applyEdit(edit);
    if (!success) {
        throw new Error('Failed to move file; check if source and target are valid');
    }
    return true;
}

/**
 * Renames a file or directory
 */
export async function renameWorkspaceFile(
    filePath: string,
    newName: string,
    overwrite: boolean = false
): Promise<boolean> {
    if (!vscode.workspace.workspaceFolders) {
        throw new Error('No workspace folder is open');
    }

    const workspaceFolder = vscode.workspace.workspaceFolders[0].uri;
    const fileUri = vscode.Uri.joinPath(workspaceFolder, filePath);
    const directoryPath = path.dirname(filePath);
    const newFileUri = vscode.Uri.joinPath(workspaceFolder, directoryPath, newName);

    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(fileUri, newFileUri, { overwrite });

    const success = await vscode.workspace.applyEdit(edit);
    if (!success) {
        throw new Error('Failed to rename file');
    }
    return true;
}

/**
 * Copies a file to a new location
 */
export async function copyWorkspaceFile(
    sourcePath: string,
    targetPath: string,
    overwrite: boolean = false
): Promise<void> {
    if (!vscode.workspace.workspaceFolders) {
        throw new Error('No workspace folder is open');
    }

    const workspaceFolder = vscode.workspace.workspaceFolders[0].uri;
    const sourceUri = vscode.Uri.joinPath(workspaceFolder, sourcePath);
    const targetUri = vscode.Uri.joinPath(workspaceFolder, targetPath);

    // Check if target exists
    let targetExists = false;
    try {
        await vscode.workspace.fs.stat(targetUri);
        targetExists = true;
    } catch (error) {
        if (error instanceof vscode.FileSystemError && error.code !== 'FileNotFound') {
            throw error;
        }
    }

    if (targetExists && !overwrite) {
        throw new Error(`Target file ${targetPath} already exists. Use overwrite=true to overwrite.`);
    }

    const fileContent = await vscode.workspace.fs.readFile(sourceUri);
    await vscode.workspace.fs.writeFile(targetUri, fileContent);
}

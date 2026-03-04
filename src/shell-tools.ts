import * as vscode from 'vscode';

/**
 * Waits briefly for shell integration to become available
 */
async function waitForShellIntegration(terminal: vscode.Terminal, timeout = 1000): Promise<boolean> {
    if (terminal.shellIntegration) {
        return true;
    }

    return new Promise<boolean>(resolve => {
        const timeoutId = setTimeout(() => {
            disposable.dispose();
            resolve(false);
        }, timeout);

        const disposable = vscode.window.onDidChangeTerminalShellIntegration(e => {
            if (e.terminal === terminal && terminal.shellIntegration) {
                clearTimeout(timeoutId);
                disposable.dispose();
                resolve(true);
            }
        });
    });
}

/**
 * Executes a shell command using terminal shell integration
 */
export async function executeShellCommand(
    terminal: vscode.Terminal,
    command: string,
    cwd?: string,
    timeout: number = 10000
): Promise<{ output: string }> {
    terminal.show();
    
    let fullCommand = command;
    if (cwd) {
        if (cwd !== '.' && cwd !== './') {
            const quotedPath = cwd.includes(' ') ? `"${cwd}"` : cwd;
            fullCommand = `cd ${quotedPath} && ${command}`;
        }
    }
    
    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Command timed out after ${timeout}ms`)), timeout);
    });
    
    if (!terminal.shellIntegration) {
        await waitForShellIntegration(terminal);
        if (!terminal.shellIntegration) {
            throw new Error('Shell integration not available');
        }
    }
    
    const execution = terminal.shellIntegration.executeCommand(fullCommand);
    let output = '';
    
    const executionPromise = async (): Promise<{ output: string }> => {
        const outputStream = (execution as any).read();
        for await (const data of outputStream) {
            output += data;
        }
        return { output };
    };
    
    return Promise.race([executionPromise(), timeoutPromise]);
}

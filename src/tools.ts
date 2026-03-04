export const mcpTools = [
    // Existing Bifrost tools...
    {
        name: "find_usages",
        description: 
            "Finds all references to a symbol at a specified location in code. This tool helps you identify where functions, variables, types, or other symbols are used throughout the codebase. " +
            "It performs a deep semantic analysis to find true references, not just text matches. " +
            "The results include:\n" +
            "- Complete file path for each reference\n" +
            "- Precise location (line and character position)\n" +
            "- Context preview showing how the symbol is used\n" +
            "- Optional inclusion of the symbol's declaration\n\n" +
            "This is particularly useful for:\n" +
            "- Understanding dependencies between different parts of the code\n" +
            "- Safely planning refactoring operations\n" +
            "- Analyzing the impact of potential changes\n" +
            "- Tracing data flow through the application\n\n" +
            "Note: Line numbers are 0-based (first line is 0), while character positions are 0-based (first character is 0).",
        inputSchema: {
            type: "object",
            properties: {
                textDocument: {
                    type: "object",
                    description: "The document containing the symbol",
                    properties: {
                        uri: {
                            type: "string",
                            description: "URI of the document (file:///path/to/file format)"
                        }
                    },
                    required: ["uri"]
                },
                position: {
                    type: "object",
                    description: "The position of the symbol",
                    properties: {
                        line: {
                            type: "number",
                            description: "Zero-based line number"
                        },
                        character: {
                            type: "number",
                            description: "Zero-based character position"
                        }
                    },
                    required: ["line", "character"]
                },
                context: {
                    type: "object",
                    description: "Additional context for the request",
                    properties: {
                        includeDeclaration: {
                            type: "boolean",
                            description: "Whether to include the declaration of the symbol in the results",
                            default: true
                        }
                    }
                }
            },
            required: ["textDocument", "position"]
        }
    },
    // ... (all existing Bifrost tools preserved)
    {
        name: "go_to_definition",
        description: "Navigates to the original definition of a symbol at a specified location in code.",
        inputSchema: {
            type: "object",
            properties: {
                textDocument: {
                    type: "object",
                    properties: { uri: { type: "string" } },
                    required: ["uri"]
                },
                position: {
                    type: "object",
                    properties: {
                        line: { type: "number" },
                        character: { type: "number" }
                    },
                    required: ["line", "character"]
                }
            },
            required: ["textDocument", "position"]
        }
    },
    {
        name: "find_implementations",
        description: "Discovers all concrete implementations of an interface, abstract class, or abstract method.",
        inputSchema: {
            type: "object",
            properties: {
                textDocument: {
                    type: "object",
                    properties: { uri: { type: "string" } },
                    required: ["uri"]
                },
                position: {
                    type: "object",
                    properties: {
                        line: { type: "number" },
                        character: { type: "number" }
                    },
                    required: ["line", "character"]
                }
            },
            required: ["textDocument", "position"]
        }
    },
    
    // NEW: vscode-mcp-server file tools
    {
        name: "list_files_code",
        description: 
            "Explores directory structure in VS Code workspace.\n\n" +
            "WHEN TO USE: Understanding project structure, finding files before read/modify operations.\n\n" +
            "CRITICAL: NEVER set recursive=true on root directory (.) - output too large. Use recursive only on specific subdirectories.\n\n" +
            "Returns files and directories at specified path. Start with path='.' to explore root, then dive into specific subdirectories with recursive=true.",
        inputSchema: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "The path to list files from"
                },
                recursive: {
                    type: "boolean",
                    description: "Whether to list files recursively",
                    default: false
                }
            },
            required: ["path"]
        }
    },
    {
        name: "read_file_code",
        description: 
            "Retrieves file contents with size limits and partial reading support.\n\n" +
            "WHEN TO USE: Reading code, config files, analyzing implementations. Files >100k chars will fail.\n\n" +
            "Encoding: Text encodings (utf-8, latin1, etc.) for text files, 'base64' for base64-encoded string.\n" +
            "Line numbers: Use startLine/endLine (1-based) for large files to read specific sections only.\n\n" +
            "If file too large: Use startLine/endLine to read relevant sections only.",
        inputSchema: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "The path to the file to read"
                },
                encoding: {
                    type: "string",
                    description: "Encoding to convert the file content. Use 'base64' for base64-encoded string",
                    default: "utf-8"
                },
                maxCharacters: {
                    type: "number",
                    description: "Maximum character count (default: 100,000)",
                    default: 100000
                },
                startLine: {
                    type: "number",
                    description: "The start line number (1-based, inclusive). Default: read from beginning",
                    default: -1
                },
                endLine: {
                    type: "number",
                    description: "The end line number (1-based, inclusive). Default: read to end",
                    default: -1
                }
            },
            required: ["path"]
        }
    },
    {
        name: "create_file_code",
        description: 
            "Creates new files or completely rewrites existing files.\n\n" +
            "WHEN TO USE: New files, large modifications (>10 lines), complete file rewrites.\n" +
            "USE replace_lines_code instead for: small edits ≤10 lines where you have exact original content.\n\n" +
            "File handling: Use overwrite=true to replace existing files, ignoreIfExists=true to skip if file exists.\n" +
            "Always check with list_files_code first unless you specifically want to overwrite.",
        inputSchema: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "The path to the file to create"
                },
                content: {
                    type: "string",
                    description: "The content to write to the file"
                },
                overwrite: {
                    type: "boolean",
                    description: "Whether to overwrite if the file exists",
                    default: false
                },
                ignoreIfExists: {
                    type: "boolean",
                    description: "Whether to ignore if the file exists",
                    default: false
                }
            },
            required: ["path", "content"]
        }
    },
    {
        name: "replace_lines_code",
        description: 
            "Replaces specific lines in existing files with exact content validation.\n\n" +
            "WHEN TO USE: Modifications ≤10 lines where you have exact original text, or inserts of any size.\n" +
            "USE create_file_code instead for: new files, large modifications (>10 lines), or when original text is uncertain.\n\n" +
            "CRITICAL: originalCode parameter must match current file content exactly or tool fails.\n" +
            "If tool fails: run read_file_code on target lines to get current content, then retry.\n\n" +
            "Parameters use 1-based line numbers. Always verify line numbers with read_file_code.",
        inputSchema: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "The path to the file to modify"
                },
                startLine: {
                    type: "number",
                    description: "The start line number (1-based, inclusive)"
                },
                endLine: {
                    type: "number",
                    description: "The end line number (1-based, inclusive)"
                },
                content: {
                    type: "string",
                    description: "The new content to replace the lines with"
                },
                originalCode: {
                    type: "string",
                    description: "The original code for validation - must match exactly"
                }
            },
            required: ["path", "startLine", "endLine", "content", "originalCode"]
        }
    },
    {
        name: "move_file_code",
        description: 
            "Moves a file or directory to a new location using VS Code's refactoring.\n\n" +
            "Updates all references to the moved file in the workspace automatically.",
        inputSchema: {
            type: "object",
            properties: {
                sourcePath: {
                    type: "string",
                    description: "The current path of the file or directory to move"
                },
                targetPath: {
                    type: "string",
                    description: "The new path where the file should be moved"
                },
                overwrite: {
                    type: "boolean",
                    description: "Whether to overwrite if target exists",
                    default: false
                }
            },
            required: ["sourcePath", "targetPath"]
        }
    },
    {
        name: "rename_file_code",
        description: 
            "Renames a file or directory using VS Code's WorkspaceEdit API.\n\n" +
            "Updates all references to the renamed file in the workspace automatically.",
        inputSchema: {
            type: "object",
            properties: {
                filePath: {
                    type: "string",
                    description: "The current path of the file to rename"
                },
                newName: {
                    type: "string",
                    description: "The new name for the file"
                },
                overwrite: {
                    type: "boolean",
                    description: "Whether to overwrite if a file with new name exists",
                    default: false
                }
            },
            required: ["filePath", "newName"]
        }
    },
    {
        name: "copy_file_code",
        description: 
            "Copies a file to a new location.\n\n" +
            "WHEN TO USE: Creating backups, duplicating files for testing, creating template files.\n" +
            "LIMITATION: Only works for files, not directories.",
        inputSchema: {
            type: "object",
            properties: {
                sourcePath: {
                    type: "string",
                    description: "The path of the file to copy"
                },
                targetPath: {
                    type: "string",
                    description: "The path where the copy should be created"
                },
                overwrite: {
                    type: "boolean",
                    description: "Whether to overwrite if target already exists",
                    default: false
                }
            },
            required: ["sourcePath", "targetPath"]
        }
    },
    {
        name: "execute_shell_command_code",
        description: 
            "Executes shell commands in VS Code integrated terminal.\n\n" +
            "WHEN TO USE: Running CLI commands, builds, git operations, npm/pip installs.\n\n" +
            "Working directory: Use cwd to run commands in specific directories.\n" +
            "Timeout: Commands must complete within specified time (default 10s) or returns timeout error, but command may still be running in terminal.",
        inputSchema: {
            type: "object",
            properties: {
                command: {
                    type: "string",
                    description: "The shell command to execute"
                },
                cwd: {
                    type: "string",
                    description: "Optional working directory for the command",
                    default: "."
                },
                timeout: {
                    type: "number",
                    description: "Command timeout in milliseconds (default: 10000)",
                    default: 10000
                }
            },
            required: ["command"]
        }
    }
];

// Tool descriptions export for quick reference
export const toolsDescriptions = [
    // Bifrost tools
    { name: "find_usages", description: "Find all references to a symbol" },
    { name: "go_to_definition", description: "Find definition of a symbol" },
    { name: "find_implementations", description: "Find implementations of interface/abstract method" },
    { name: "get_hover_info", description: "Get hover information for a symbol" },
    { name: "get_document_symbols", description: "Get all symbols in document" },
    { name: "get_completions", description: "Get code completion suggestions" },
    { name: "get_signature_help", description: "Get function signature information" },
    { name: "get_rename_locations", description: "Get locations affected by renaming" },
    { name: "rename", description: "Rename a symbol" },
    { name: "get_code_actions", description: "Get available code actions and refactorings" },
    { name: "get_semantic_tokens", description: "Get semantic token information" },
    { name: "get_call_hierarchy", description: "Get call hierarchy" },
    { name: "get_type_hierarchy", description: "Get type hierarchy" },
    { name: "get_code_lens", description: "Gets CodeLens inline information" },
    { name: "get_selection_range", description: "Gets smart selection ranges" },
    { name: "get_type_definition", description: "Find type definitions" },
    { name: "get_declaration", description: "Find declarations" },
    { name: "get_document_highlights", description: "Find all highlights in document" },
    { name: "get_workspace_symbols", description: "Search symbols across workspace" },
    // New vscode-mcp-server tools
    { name: "list_files_code", description: "List files and directories in workspace" },
    { name: "read_file_code", description: "Read file contents" },
    { name: "create_file_code", description: "Create new files" },
    { name: "replace_lines_code", description: "Replace specific lines in files" },
    { name: "move_file_code", description: "Move files/directories" },
    { name: "rename_file_code", description: "Rename files" },
    { name: "copy_file_code", description: "Copy files" },
    { name: "execute_shell_command_code", description: "Execute shell commands in terminal" }
];

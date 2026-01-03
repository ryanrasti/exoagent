"""Tool utilities for extracting function signatures and generating tool APIs."""
import inspect
from typing import Any, Callable, Dict, List, Optional, TypeVar
from mcp.server.fastmcp import FastMCP

T = TypeVar('T')


class ToolWrapper:
    """Wrapper for tools that generates prompts and runs MCP server."""
    
    def __init__(self, functions: List[Callable], opts: Optional[Dict[str, Any]] = None):
        self.functions = functions
        self.opts = opts
        self._server: Optional[FastMCP] = None
    
    def _get_server(self) -> FastMCP:
        """Get or create the MCP server."""
        if self._server is None:
            self._server = FastMCP('ToolApi')
            for fn in self.functions:
                self._server.add_tool(fn, name=fn.__name__)
        return self._server
    
    def generate_prompt(self) -> str:
        """Generate a prompt showing available tools and how to use them."""
        server = self._get_server()
        
        # Use FastMCP to get tool definitions
        lines = ["You have access to these tools via `api`:", ""]
        
        for fn in self.functions:
            sig_obj = inspect.signature(fn)
            doc = inspect.getdoc(fn)
            params = sig_obj.parameters
            
            # Build parameter list for signature
            param_parts = []
            for param_name, param in params.items():
                if param.annotation != inspect.Parameter.empty:
                    annotation_str = param.annotation.__name__ if hasattr(param.annotation, '__name__') else str(param.annotation)
                    param_parts.append(f"{param_name}: {annotation_str}")
                else:
                    param_parts.append(param_name)
            
            # Get return type
            return_type = sig_obj.return_annotation
            if return_type != inspect.Signature.empty:
                return_type_str = return_type.__name__ if hasattr(return_type, '__name__') else str(return_type)
                signature = f"{fn.__name__}({', '.join(param_parts)}) -> {return_type_str}"
            else:
                signature = f"{fn.__name__}({', '.join(param_parts)})"
            
            lines.append(signature)
            
            if doc:
                # Add docstring, indented
                doc_lines = doc.strip().split('\n')
                for doc_line in doc_lines:
                    lines.append(f"  {doc_line}")
            lines.append("")
        
        lines.append("Write your solution as:")
        lines.append("")
        lines.append("async def run(api):")
        lines.append("    ...")
        
        return '\n'.join(lines)
    
    def run(self) -> FastMCP:
        """Run the MCP server."""
        return self._get_server()


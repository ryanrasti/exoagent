"""Code mode for executing Python code with tool access via RPC."""
import inspect
import json
import os
import threading
from typing import Any, Callable, Dict, List, Optional, Protocol, TextIO

from .tool import ToolWrapper


class FileTransport:
    """Transport for RPC communication using file-like objects."""
    
    def __init__(self, input_file: Any, output_file: Any):
        """Initialize transport with file-like objects.
        
        Args:
            input_file: File-like object opened in binary read mode
            output_file: File-like object opened in binary write mode
        """
        self.input_file = input_file
        self.output_file = output_file
        self._lock = threading.Lock()
    
    async def send(self, message: str) -> None:
        """Send a message over the transport."""
        message_bytes = message.encode('utf-8')
        length = len(message_bytes)
        
        if length > 0xFFFFFFFF:
            raise ValueError('Message length exceeds maximum allowed size (4GB)')
        
        # Write length (4 bytes, little-endian) and message
        with self._lock:
            length_bytes = length.to_bytes(4, byteorder='little', signed=False)
            self.output_file.write(length_bytes)
            self.output_file.write(message_bytes)
            self.output_file.flush()
    
    async def receive(self) -> str:
        """Receive a message from the transport."""
        # Read length (4 bytes)
        length_bytes = self.input_file.read(4)
        if len(length_bytes) != 4:
            raise IOError('Stream closed')
        
        length = int.from_bytes(length_bytes, byteorder='little', signed=False)
        
        # Validate length to prevent DoS
        if length > 100 * 1024 * 1024:  # 100MB limit
            raise ValueError('Message length exceeds maximum allowed size')
        
        if length == 0:
            return ''
        
        # Read message
        message_bytes = self.input_file.read(length)
        if len(message_bytes) != length:
            raise IOError('Stream closed')
        
        return message_bytes.decode('utf-8')
    
    def abort(self, reason: Any) -> None:
        """Abort the transport."""
        try:
            self.input_file.close()
        except Exception:
            pass
        try:
            self.output_file.close()
        except Exception:
            pass


class RpcSession:
    """Simple RPC session for method calls."""
    
    def __init__(self, transport: FileTransport, target: Any):
        self.transport = transport
        self.target = target
        self._running = False
        self._thread: Optional[threading.Thread] = None
    
    async def start(self) -> None:
        """Start the RPC session in a thread."""
        if self._running:
            return
        
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
    
    def _run_loop(self) -> None:
        """Run the RPC message loop."""
        import asyncio
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(self._async_run_loop())
    
    async def _async_run_loop(self) -> None:
        """Async RPC message loop."""
        while self._running:
            try:
                message = await self.transport.receive()
                if not message:
                    break
                
                # Parse and execute RPC call
                request = json.loads(message)
                
                method_name = request.get('method')
                args = request.get('args', [])
                kwargs = request.get('kwargs', {})
                request_id = request.get('id')
                
                # Call method on target
                if hasattr(self.target, method_name):
                    method = getattr(self.target, method_name)
                    if callable(method):
                        try:
                            if inspect.iscoroutinefunction(method):
                                result = await method(*args, **kwargs)
                            else:
                                result = method(*args, **kwargs)
                            
                            # Send response
                            response = {
                                'id': request_id,
                                'result': result,
                                'error': None,
                            }
                            await self.transport.send(json.dumps(response))
                        except Exception as e:
                            response = {
                                'id': request_id,
                                'result': None,
                                'error': str(e),
                            }
                            await self.transport.send(json.dumps(response))
            except Exception as e:
                if self._running:
                    # Log error and continue
                    print(f"RPC error: {e}")
                break
    
    async def get_remote_main(self) -> Any:
        """Get the remote main object (proxy)."""
        await self.start()
        return RpcProxy(self.transport)
    
    def stop(self) -> None:
        """Stop the RPC session."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=1.0)


class RpcMethod:
    """Callable RPC method proxy."""
    
    def __init__(self, transport: FileTransport, method_name: str, request_id_gen: Callable[[], int]):
        self.transport = transport
        self.method_name = method_name
        self._get_next_id = request_id_gen
    
    async def __call__(self, *args: Any, **kwargs: Any) -> Any:
        """Make an RPC call."""
        request_id = self._get_next_id()
        request = {
            'method': self.method_name,
            'args': args,
            'kwargs': kwargs,
            'id': request_id,
        }
        
        await self.transport.send(json.dumps(request))
        
        # Wait for response
        response_str = await self.transport.receive()
        response = json.loads(response_str)
        
        if response.get('id') != request_id:
            raise ValueError('Response ID mismatch')
        
        if response.get('error'):
            raise RuntimeError(response['error'])
        
        return response.get('result')


class RpcProxy:
    """Proxy object for making RPC calls."""
    
    def __init__(self, transport: FileTransport):
        self.transport = transport
        self._request_id = 0
        self._lock = threading.Lock()
        self._cache: Dict[str, RpcMethod] = {}
    
    def _get_next_id(self) -> int:
        with self._lock:
            self._request_id += 1
            return self._request_id
    
    def __getattr__(self, name: str) -> RpcMethod:
        """Return a callable that makes RPC requests."""
        if name not in self._cache:
            self._cache[name] = RpcMethod(self.transport, name, self._get_next_id)
        return self._cache[name]


class SafeEvalContext(Protocol):
    """Protocol for safe evaluation context."""
    
    async def safe_eval(self, code: str) -> Dict[str, Any]:
        """Execute code safely and return input/output streams."""
        ...


class CodeMode:
    """Code mode for wrapping Python functions as tools."""
    
    def __init__(self, context: SafeEvalContext):
        self.context = context
    
    async def wrap(self, functions: List[Callable], opts: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Wrap Python functions into a tool that executes code."""
        # 1. Create tool wrapper
        tool_wrapper = ToolWrapper(functions, opts)
        
        # 2. Generate prompt
        description = tool_wrapper.generate_prompt()
        
        # 3. Return tool definition
        async def execute(code: str, execution_opts: Optional[Dict[str, Any]] = None) -> Any:
            # Create pipes for bidirectional communication
            # client_read_fd, server_write_fd for client->server
            # server_read_fd, client_write_fd for server->client
            client_read_fd, server_write_fd = os.pipe()
            server_read_fd, client_write_fd = os.pipe()
            
            try:
                # Open file objects from the client side (binary mode)
                client_input = open(client_read_fd, 'rb', closefd=False)
                client_output = open(client_write_fd, 'wb', closefd=False)
                
                # Open file objects from the server side (binary mode)
                server_input = open(server_read_fd, 'rb', closefd=False)
                server_output = open(server_write_fd, 'wb', closefd=False)
                
                # Create transports
                client_transport = FileTransport(client_input, client_output)
                server_transport = FileTransport(server_input, server_output)
                
                # Generate MCP server for tool API
                tool_wrapper = ToolWrapper(functions, opts or execution_opts)
                mcp_server = tool_wrapper.run()
                
                # Create a wrapper that bridges RPC to MCP server
                class ToolApi:
                    """RPC target that delegates to MCP server."""
                    __return_value__: Any = None
                    __raw_code__: str
                    
                    def __init__(self, code: str):
                        self.__raw_code__ = code
                        self.mcp_server = mcp_server
                    
                    async def __code__(self) -> str:
                        return self.__raw_code__
                    
                    def __return__(self, result: Any) -> None:
                        self.__return_value__ = result
                
                # Add methods to ToolApi that delegate to MCP server
                for fn in functions:
                    def create_delegate(func: Callable):
                        async def delegate_method(self: ToolApi, *args: Any, **kwargs: Any) -> Any:
                            # Call the tool via MCP server
                            return await self.mcp_server.call_tool(func.__name__, *args, **kwargs)
                        return delegate_method
                    
                    setattr(ToolApi, fn.__name__, create_delegate(fn))
                
                api = ToolApi(code)
                
                # Create RPC session on server side
                session = RpcSession(server_transport, api)
                
                # Execute code in a thread
                def run_code():
                    import asyncio
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    
                    async def async_run():
                        # Get remote proxy (client side)
                        remote_api = RpcProxy(client_transport)
                        
                        # Start server session
                        await session.start()
                        
                        # Execute the code
                        # The code should be a string that defines a function
                        # We'll compile and execute it
                        namespace = {'api': remote_api}
                        exec(code, namespace)
                        
                        # Call the execute function if it exists
                        if 'execute' in namespace:
                            result = await namespace['execute'](remote_api)
                            await remote_api.__return__(result)
                    
                    try:
                        loop.run_until_complete(async_run())
                    finally:
                        loop.close()
                        session.stop()
                
                thread = threading.Thread(target=run_code, daemon=True)
                thread.start()
                thread.join()
                
                return api.__return_value__
            finally:
                # Close file descriptors
                for fd in [client_read_fd, server_write_fd, server_read_fd, client_write_fd]:
                    try:
                        os.close(fd)
                    except Exception:
                        pass
        
        return {
            'description': description,
            'execute': execute,
        }


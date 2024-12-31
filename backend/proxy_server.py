from aiohttp import web
import aiohttp
import tldextract
import asyncio
import socket
import logging
import json
from typing import Set, Dict, Any

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

class ProxyServer:
    def __init__(self):
        self.blocked_domains = {'facebook.com', 'twitter.com'}
        self.blocked_keywords = {'gambling', 'adult'}
        self.clients: Set[web.WebSocketResponse] = set()

    def is_blocked(self, url: str) -> tuple[bool, str]:
        try:
            # Extract domain
            ext = tldextract.extract(url)
            domain = f"{ext.domain}.{ext.suffix}"
            
            # Check domain blocks
            if domain.lower() in {d.lower() for d in self.blocked_domains}:
                return True, f"Domain {domain} is blocked"
            
            # Check keyword blocks
            for keyword in self.blocked_keywords:
                if keyword in url.lower():
                    return True, f"Contains blocked keyword: {keyword}"
            
            return False, "URL is allowed"
        except Exception as e:
            logger.error(f"Error checking URL: {e}")
            return True, f"Error checking URL: {str(e)}"

    async def forward_request(self, request: web.Request) -> web.Response:
        """Handle HTTP forwarding"""
        target_url = f"http://{request.host}{request.path_qs}"
        logger.info(f"Forwarding request to: {target_url}")

        is_blocked, reason = self.is_blocked(target_url)
        if is_blocked:
            return web.Response(text=reason, status=403)

        try:
            async with aiohttp.ClientSession() as session:
                # Forward the request
                method = request.method
                headers = dict(request.headers)
                body = await request.read()

                async with session.request(
                    method=method,
                    url=target_url,
                    headers=headers,
                    data=body,
                    allow_redirects=True
                ) as response:
                    content = await response.read()
                    return web.Response(
                        body=content,
                        status=response.status,
                        headers=response.headers
                    )
        except Exception as e:
            logger.error(f"Error forwarding request: {e}")
            return web.Response(text=str(e), status=500)

    async def handle_connect(self, request: web.Request) -> web.StreamResponse:
        """Handle HTTPS CONNECT tunneling"""
        try:
            host, port = request.path.split(':')
            port = int(port)
            
            # Check if domain is blocked
            is_blocked, reason = self.is_blocked(f"https://{host}")
            if is_blocked:
                return web.Response(text=reason, status=403)

            # Create connection to target
            dest_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            try:
                dest_socket.connect((host, port))
            except socket.error as e:
                logger.error(f"Failed to connect to target: {e}")
                return web.Response(text=str(e), status=502)

            # Send connection established
            client_socket = request.transport.get_extra_info('socket')
            client_socket.send(b'HTTP/1.1 200 Connection established\r\n\r\n')

            # Set up two-way forwarding
            async def forward(source, destination):
                try:
                    while True:
                        data = await source.read(8192)
                        if not data:
                            break
                        destination.send(data)
                except Exception as e:
                    logger.error(f"Forward error: {e}")

            # Create reader/writer pairs
            client_reader = asyncio.StreamReader()
            protocol = asyncio.StreamReaderProtocol(client_reader)
            await asyncio.get_event_loop().create_connection(
                lambda: protocol, sock=client_socket
            )

            dest_reader = asyncio.StreamReader()
            protocol = asyncio.StreamReaderProtocol(dest_reader)
            await asyncio.get_event_loop().create_connection(
                lambda: protocol, sock=dest_socket
            )

            # Start forwarding in both directions
            await asyncio.gather(
                forward(client_reader, dest_socket),
                forward(dest_reader, client_socket)
            )

            return web.Response()
        except Exception as e:
            logger.error(f"CONNECT error: {e}")
            return web.Response(text=str(e), status=500)

    async def proxy_handler(self, request: web.Request) -> web.Response:
        """Main proxy request handler"""
        logger.info(f"Received: {request.method} {request.path_qs}")
        
        if request.method == 'CONNECT':
            return await self.handle_connect(request)
        else:
            return await self.forward_request(request)

    async def websocket_handler(self, request: web.Request) -> web.WebSocketResponse:
        """Handle WebSocket connections for UI"""
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self.clients.add(ws)
        
        try:
            # Send initial rules
            await ws.send_json({
                'type': 'rules',
                'blockedDomains': list(self.blocked_domains),
                'blockedKeywords': list(self.blocked_keywords)
            })
            
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    try:
                        data = msg.json()
                        if data['type'] == 'test_url':
                            is_blocked, reason = self.is_blocked(data['url'])
                            await ws.send_json({
                                'type': 'test_result',
                                'url': data['url'],
                                'blocked': is_blocked,
                                'reason': reason
                            })
                    except Exception as e:
                        logger.error(f"WebSocket message error: {e}")
        finally:
            self.clients.remove(ws)
        
        return ws

    async def add_rule(self, request: web.Request) -> web.Response:
        """Handle adding new blocking rules"""
        try:
            data = await request.json()
            rule_type = data.get('type')
            value = data.get('value', '').lower().strip()
            
            if not value:
                return web.Response(status=400, text="Value cannot be empty")
            
            if rule_type == 'domain':
                self.blocked_domains.add(value)
            elif rule_type == 'keyword':
                self.blocked_keywords.add(value)
            else:
                return web.Response(status=400, text="Invalid rule type")
            
            # Notify all clients of the update
            for client in self.clients:
                await client.send_json({
                    'type': 'rules',
                    'blockedDomains': list(self.blocked_domains),
                    'blockedKeywords': list(self.blocked_keywords)
                })
            
            return web.Response(text='OK')
        except Exception as e:
            logger.error(f"Error adding rule: {e}")
            return web.Response(status=400, text=str(e))

async def init_app() -> web.Application:
    app = web.Application()
    proxy = ProxyServer()
    
    # CORS middleware
    @web.middleware
    async def cors_middleware(request: web.Request, handler):
        if request.method == 'OPTIONS':
            return web.Response(headers={
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': '*',
                'Access-Control-Allow-Headers': '*',
            })
        
        response = await handler(request)
        response.headers['Access-Control-Allow-Origin'] = '*'
        return response
    
    app.middlewares.append(cors_middleware)
    
    app.router.add_get('/ws', proxy.websocket_handler)
    app.router.add_post('/add-rule', proxy.add_rule)
    app.router.add_route('*', '/{path:.*}', proxy.proxy_handler)
    
    return app

if __name__ == '__main__':
    logging.basicConfig(level=logging.DEBUG)
    app = init_app()
    web.run_app(app, port=8888)
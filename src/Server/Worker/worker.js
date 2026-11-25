import { DurableObject } from 'cloudflare:workers'
import page from './index.html'
import { rejectRoom } from './game-room.js'

export { GameRoom } from './game-room.js'

export default {
  fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(page, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }
    if (url.pathname === '/ws' && request.method === 'GET') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('WebSocket required', { status: 426 })
      }
      if (url.searchParams.has('room')) {
        const room = url.searchParams.get('room').trim().toUpperCase()
        if (!/^[A-Z0-9_-]{1,32}$/.test(room)) {
          return rejectRoom('bad-room', 'Room code must be 1-32 letters, digits, - or _.')
        }
        return env.GAME_ROOMS.getByName(room).fetch(request)
      }
      return env.DEVICES.getByName('online').fetch(request)
    }
    return new Response('Not found', { status: 404 })
  },
}

export class Devices extends DurableObject {
  fetch(request) {
    const name = new URL(request.url).searchParams.get('name')?.trim().slice(0, 40)
    if (!name) return new Response('Name required', { status: 400 })

    const [client, server] = Object.values(new WebSocketPair())
    const id = crypto.randomUUID()
    this.ctx.acceptWebSocket(server, [id])
    server.serializeAttachment({ id, name })
    server.send(JSON.stringify({ type: 'joined', id }))
    this.broadcast()
    return new Response(null, { status: 101, webSocket: client })
  }

  webSocketMessage(socket, message) {
    if (typeof message !== 'string' || message.length > 256) return
    let data
    try {
      data = JSON.parse(message)
    } catch {
      return
    }
    if (data?.type !== 'ping' && data?.type !== 'pong') return
    const { type, to, ticket } = data
    if (typeof to !== 'string' || to.length !== 36 || !Number.isSafeInteger(ticket)) return

    const [target] = this.ctx.getWebSockets(to)
    if (target === socket) return
    if (target?.readyState === WebSocket.OPEN) {
      const from = socket.deserializeAttachment().id
      target.send(JSON.stringify({ type, from, ticket }))
    } else if (type === 'ping') {
      socket.send(JSON.stringify({ type: 'offline', from: to, ticket }))
    }
  }

  webSocketClose(socket) {
    this.broadcast(socket)
  }

  webSocketError(socket) {
    this.broadcast(socket)
  }

  broadcast(disconnected) {
    const sockets = this.ctx.getWebSockets().filter(socket => socket !== disconnected && socket.readyState === WebSocket.OPEN)
    const message = JSON.stringify({ type: 'devices', devices: sockets.map(socket => socket.deserializeAttachment()) })
    for (const socket of sockets) socket.send(message)
  }
}

import { DurableObject } from 'cloudflare:workers'

const MAX_MESSAGE_BYTES = 16 * 1024
const encoder = new TextEncoder()

export function rejectRoom(reason, message) {
  const [client, server] = Object.values(new WebSocketPair())
  server.accept()
  server.send(JSON.stringify({ type: 'rejected', reason, message }))
  server.close(1008, 'rejected')
  return new Response(null, { status: 101, webSocket: client })
}

export class GameRoom extends DurableObject {
  fetch() {
    const first = this.playerSocket(1)
    const second = this.playerSocket(2)
    if (first && second) return rejectRoom('room-full', 'This room already has two players.')

    const player = first ? 2 : 1
    const peer = first ?? second
    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server, [String(player)])
    server.serializeAttachment(player)
    server.send(JSON.stringify({ type: 'joined', player, peer: Boolean(peer) }))
    peer?.send('{"type":"peer-joined"}')
    return new Response(null, { status: 101, webSocket: client })
  }

  webSocketMessage(socket, message) {
    const player = socket.deserializeAttachment()
    if (!player) return
    if (typeof message !== 'string') return this.leave(socket, 1003, 'Text message required')
    if (message.length > MAX_MESSAGE_BYTES || encoder.encode(message).byteLength > MAX_MESSAGE_BYTES) {
      return this.leave(socket, 1009, 'Message too large')
    }
    this.playerSocket(3 - player)?.send(message)
  }

  webSocketClose(socket, code, reason) {
    this.leave(socket, code, reason)
  }

  webSocketError(socket) {
    this.leave(socket, 1011, 'WebSocket error')
  }

  leave(socket, code, reason) {
    const player = socket.deserializeAttachment()
    if (!player) return
    socket.serializeAttachment(null)
    if (code >= 1000 && code < 5000 && ![1004, 1005, 1006, 1015].includes(code)) {
      socket.close(code, reason)
    } else {
      socket.close()
    }
    // A replacement may already occupy the seat when a delayed close arrives.
    if (!this.playerSocket(player)) this.playerSocket(3 - player)?.send('{"type":"peer-left"}')
  }

  playerSocket(player) {
    return this.ctx.getWebSockets(String(player))
      .find(socket => socket.readyState === WebSocket.OPEN && socket.deserializeAttachment() === player)
  }
}

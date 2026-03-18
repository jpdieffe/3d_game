import Peer from 'peerjs'
import type { DataConnection } from 'peerjs'
import type { NetMessage, PlayerState } from './types'

/**
 * Thin wrapper around PeerJS.
 *
 * One player calls host(), shares the displayed room code, and waits.
 * The other player calls join(code).
 * Once connected, both sides call sendPosition() every ~1/20 s.
 */
export class Network {
  private peer: Peer | null = null
  private conn: DataConnection | null = null

  /** Latest position received from the remote player (null until first packet) */
  lastRemoteState: PlayerState | null = null

  /** Called when a P2P connection is fully established */
  onPeerConnected: (() => void) | null = null

  // ── Host side ─────────────────────────────────────────────────────────────

  host(onReady: (roomId: string) => void) {
    this.peer = new Peer()
    this.peer.on('open', id => {
      onReady(id)
    })
    this.peer.on('connection', conn => {
      this.conn = conn
      this.wireConn(conn)
    })
    this.peer.on('error', err => console.error('[Network] host error', err))
  }

  // ── Join side ──────────────────────────────────────────────────────────────

  join(roomId: string, onConnected: () => void) {
    this.peer = new Peer()
    this.peer.on('open', () => {
      const conn = this.peer!.connect(roomId)
      this.conn = conn
      this.wireConn(conn)
      conn.on('open', () => {
        onConnected()
        this.onPeerConnected?.()
      })
    })
    this.peer.on('error', err => console.error('[Network] join error', err))
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private wireConn(conn: DataConnection) {
    conn.on('data', raw => {
      const msg = raw as NetMessage
      if (msg.type === 'state') {
        this.lastRemoteState = msg.state
      }
    })
    conn.on('open', () => {
      this.onPeerConnected?.()
    })
    conn.on('close', () => {
      console.log('[Network] connection closed')
      this.conn = null
    })
    conn.on('error', err => console.error('[Network] conn error', err))
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  sendPosition(state: PlayerState) {
    if (this.conn?.open) {
      const msg: NetMessage = { type: 'state', state }
      this.conn.send(msg)
    }
  }

  isConnected(): boolean {
    return this.conn?.open ?? false
  }

  destroy() {
    this.peer?.destroy()
  }
}

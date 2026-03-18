import { Engine, Scene } from '@babylonjs/core'
import { World } from './world'
import { Player } from './player'
import { RemotePlayer } from './remote'
import { Network } from './network'

// ── Engine & Scene ──────────────────────────────────────────────────────────
const canvas  = document.getElementById('renderCanvas') as HTMLCanvasElement
const engine  = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true })
const scene   = new Scene(engine)

// ── Game objects ────────────────────────────────────────────────────────────
const world   = new World(scene)
const player  = new Player(scene, world.buildings)
const remote  = new RemotePlayer(scene)
const network = new Network()

// ── Lobby UI ────────────────────────────────────────────────────────────────
const lobbyEl     = document.getElementById('lobby')!
const roomCodeEl  = document.getElementById('roomCode')!
const roomInput   = document.getElementById('roomInput') as HTMLInputElement
const statusEl    = document.getElementById('status')!
const connBadgeEl = document.getElementById('connBadge')!

function setStatus(msg: string) {
  statusEl.textContent = msg
}

function showConnected() {
  connBadgeEl.style.display = 'block'
}

function closeLobby() {
  lobbyEl.style.display = 'none'
}

function networkError(msg: string) {
  setStatus(`⚠ ${msg}`)
  statusEl.style.color = '#ff6b6b'
}

// Host button
document.getElementById('hostBtn')!.addEventListener('click', () => {
  statusEl.style.color = ''
  setStatus('Connecting to signaling server…')
  roomCodeEl.textContent = '…'
  network.onError = networkError
  network.onPeerConnected = () => {
    showConnected()
  }
  network.host(id => {
    // Show the code briefly, then drop into the game — friend can join anytime
    roomCodeEl.textContent = id
    setStatus('Playing solo — friend can join with the code above')
    setTimeout(closeLobby, 2500)
  })
})

// Join button
document.getElementById('joinBtn')!.addEventListener('click', () => {
  const code = roomInput.value.trim()
  if (!code) { setStatus('Paste a room code first.'); return }
  statusEl.style.color = ''
  setStatus('Connecting…')
  network.onError = networkError
  network.onPeerConnected = () => {
    setStatus('Connected!')
    showConnected()
    setTimeout(closeLobby, 700)
  }
  network.join(code, () => {
    setStatus('Connected!')
    showConnected()
    setTimeout(closeLobby, 700)
  })
})

// ── Game loop ───────────────────────────────────────────────────────────────
const SEND_INTERVAL = 1 / 20   // 20 Hz network updates
let sendTimer = 0

engine.runRenderLoop(() => {
  // Cap delta time to avoid tunnelling on tab-switch or pause
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05)

  player.update(dt)

  sendTimer += dt
  if (sendTimer >= SEND_INTERVAL) {
    sendTimer = 0
    if (network.isConnected()) {
      network.sendPosition(player.getState())
    }
  }

  if (network.lastRemoteState) {
    remote.updateTarget(network.lastRemoteState)
    remote.update(dt)
  }

  scene.render()
})

window.addEventListener('resize', () => engine.resize())

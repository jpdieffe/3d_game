import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Mesh,
  TransformNode,
} from '@babylonjs/core'
import type { CharacterClass } from './types'

// Per-class attack cooldowns (seconds)
const COOLDOWN: Record<CharacterClass, number> = {
  warrior: 0.55,
  wizard:  0.70,
  rogue:   0.40,
  archer:  0.65,
}

interface Effect {
  update(dt: number): boolean   // returns true when the effect is finished
  dispose(): void
}

// ── Slash effect (warrior / rogue) ─────────────────────────────────────────
// Three fanned planes that scale up and fade — looks like a sword arc
class SlashEffect implements Effect {
  private readonly root: TransformNode
  private readonly planes: Mesh[] = []
  private elapsed = 0
  private readonly duration: number

  constructor(
    scene: Scene,
    position: Vector3,
    facingAlpha: number,
    size: number,
    duration: number,
  ) {
    this.duration = duration
    this.root = new TransformNode('slash_root', scene)
    this.root.position.copyFrom(position)

    // Three slightly fanned planes give a sweeping arc look
    const offsets = [-0.28, 0, 0.28]
    offsets.forEach((yOff, i) => {
      const plane = MeshBuilder.CreatePlane(`slash_${i}`, { size }, scene)
      plane.parent = this.root
      plane.rotation.y = facingAlpha + yOff + Math.PI / 2
      plane.rotation.x = (i - 1) * 0.12   // slight tilt per blade

      const mat = new StandardMaterial(`slashMat_${i}`, scene)
      mat.diffuseColor    = new Color3(1, 0.95, 0.25)
      mat.emissiveColor   = new Color3(1, 0.8, 0.05)
      mat.backFaceCulling = false
      mat.alpha = 0.88
      plane.material = mat
      this.planes.push(plane)
    })
  }

  update(dt: number): boolean {
    this.elapsed += dt
    const t = this.elapsed / this.duration
    // Scale up from a small stub to full size
    const s = 0.25 + t * 0.75
    this.root.scaling.setAll(s)
    // Fade out faster toward the end
    this.planes.forEach(p => {
      ;(p.material as StandardMaterial).alpha = 0.88 * (1 - t * t)
    })
    return this.elapsed >= this.duration
  }

  dispose() {
    this.planes.forEach(p => p.dispose())
    this.root.dispose()
  }
}

// ── Projectile (wizard fire bolt / archer arrow) ────────────────────────────
class Projectile implements Effect {
  private readonly mesh: Mesh
  private elapsed = 0
  private readonly maxLife = 3      // seconds before auto-despawn
  private readonly speed: number
  private readonly dir: Vector3

  constructor(
    scene: Scene,
    startPos: Vector3,
    dir: Vector3,
    speed: number,
    color: Color3,
    radius: number,
    isArrow: boolean,
  ) {
    this.speed = speed
    this.dir   = dir.normalize().clone()

    if (isArrow) {
      this.mesh = MeshBuilder.CreateCylinder('arrow', {
        height: 1.1, diameter: 0.07, tessellation: 6,
      }, scene)
      // Align the cylinder (default Y-axis) to face the travel direction
      const yaw   = Math.atan2(dir.x, dir.z)
      const pitch = -Math.asin(Math.max(-1, Math.min(1, dir.y)))
      this.mesh.rotation.y = yaw
      this.mesh.rotation.x = pitch + Math.PI / 2
    } else {
      this.mesh = MeshBuilder.CreateSphere('bolt', { diameter: radius * 2, segments: 7 }, scene)
    }

    this.mesh.position.copyFrom(startPos)
    const mat = new StandardMaterial('projMat', scene)
    mat.diffuseColor  = color
    mat.emissiveColor = color.scale(0.65)
    mat.alpha = 1
    this.mesh.material = mat
  }

  update(dt: number): boolean {
    this.elapsed += dt
    this.mesh.position.addInPlace(this.dir.scale(this.speed * dt))
    // Begin fading in the second half of life
    const fadeStart = this.maxLife * 0.55
    if (this.elapsed > fadeStart) {
      const t = (this.elapsed - fadeStart) / (this.maxLife - fadeStart)
      ;(this.mesh.material as StandardMaterial).alpha = Math.max(0, 1 - t)
    }
    return this.elapsed >= this.maxLife
  }

  dispose() { this.mesh.dispose() }
}

// ── AttackSystem ────────────────────────────────────────────────────────────
export class AttackSystem {
  private effects: Effect[] = []
  private cooldown = 0

  update(dt: number) {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt)
    this.effects = this.effects.filter(e => {
      if (e.update(dt)) { e.dispose(); return false }
      return true
    })
  }

  canAttack(): boolean { return this.cooldown <= 0 }

  /**
   * Trigger an attack for the given character class.
   * feetPos : player feet world position
   * alpha   : camera yaw  (ArcRotateCamera.alpha)
   * beta    : camera polar angle from top (ArcRotateCamera.beta)
   */
  attack(
    scene: Scene,
    cls: CharacterClass,
    feetPos: Vector3,
    alpha: number,
    beta: number,
  ) {
    if (!this.canAttack()) return
    this.cooldown = COOLDOWN[cls]

    // XZ player-facing direction (horizontal only, for slashes)
    const fwdX = -Math.cos(alpha)
    const fwdZ = -Math.sin(alpha)

    // Full 3-D camera-forward direction (for projectiles)
    // ArcRotateCamera position relative to target:
    //   (cos(α)·sin(β),  cos(β),  sin(α)·sin(β)) * radius
    // Forward = negate of that, normalized
    const sb = Math.sin(beta), cb = Math.cos(beta)
    const sa = Math.sin(alpha), ca = Math.cos(alpha)
    const dir3 = new Vector3(-ca * sb, -cb, -sa * sb).normalize()

    // Spawn point: in front of the player at chest height
    const chest = feetPos.clone().addInPlaceFromFloats(0, 1.1, 0)

    switch (cls) {
      case 'warrior': {
        const pos = chest.clone().addInPlaceFromFloats(fwdX * 1.4, 0, fwdZ * 1.4)
        this.effects.push(new SlashEffect(scene, pos, alpha, 2.6, 0.35))
        break
      }
      case 'rogue': {
        const pos = chest.clone().addInPlaceFromFloats(fwdX * 1.0, 0, fwdZ * 1.0)
        this.effects.push(new SlashEffect(scene, pos, alpha, 1.5, 0.26))
        break
      }
      case 'wizard': {
        const pos = chest.clone().addInPlaceFromFloats(fwdX * 0.5, 0, fwdZ * 0.5)
        this.effects.push(new Projectile(scene, pos, dir3, 22, new Color3(1, 0.3, 0.05), 0.22, false))
        break
      }
      case 'archer': {
        const pos = chest.clone().addInPlaceFromFloats(fwdX * 0.5, 0.1, fwdZ * 0.5)
        this.effects.push(new Projectile(scene, pos, dir3, 30, new Color3(0.85, 0.65, 0.2), 0.065, true))
        break
      }
    }
  }

  dispose() {
    this.effects.forEach(e => e.dispose())
    this.effects = []
  }
}

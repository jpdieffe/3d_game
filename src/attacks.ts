import '@babylonjs/loaders/glTF'
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


// â”€â”€ Self-managing explosion visual â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function spawnExplosion(scene: Scene, pos: Vector3, maxRadius: number): void {
  const mesh = MeshBuilder.CreateSphere('explosion', { diameter: 0.1, segments: 8 }, scene)
  mesh.position.copyFrom(pos)
  const mat = new StandardMaterial('explosionMat_' + Math.random(), scene)
  mat.diffuseColor    = new Color3(1, 0.55, 0.05)
  mat.emissiveColor   = new Color3(1, 0.25, 0)
  mat.backFaceCulling = false
  mat.alpha = 0.9
  mesh.material = mat
  let elapsed = 0
  const DURATION = 0.55
  const obs = scene.onBeforeRenderObservable.add(() => {
    elapsed += scene.getEngine().getDeltaTime() / 1000
    const t = Math.min(1, elapsed / DURATION)
    mesh.scaling.setAll(maxRadius * 2 * (t < 0.35 ? t / 0.35 : 1))
    ;(mesh.material as StandardMaterial).alpha = 0.9 * (1 - t * t)
    if (elapsed >= DURATION) {
      mesh.dispose()
      scene.onBeforeRenderObservable.remove(obs)
    }
  })
}

// Per-class attack cooldowns (seconds)
const COOLDOWN: Record<CharacterClass, number> = {
  warrior: 0.55,
  wizard:  0.70,
  rogue:   0.40,
  archer:  0.65,
}

interface Effect {
  update(dt: number): boolean   // true = finished
  dispose(): void
}


// ── Sword Swing ──────────────────────────────────────────────────────────────
// Uses a two-node hierarchy:
//  yawPivot  – tracks posRef live; rotation.y = facing yaw
//  swingPivot – child of yawPivot; placed in front; rotation.x sweeps top-down
// This ensures the sweep is always in the character's local pitch axis so the
// swing direction correctly follows any facing direction.
export class SwordSwing implements Effect {
  private readonly yawPivot:   TransformNode   // tracks player position + yaw
  private readonly swingPivot: TransformNode   // child; sweeps rotation.x
  private readonly blades: Mesh[] = []
  private elapsed = 0
  private hitFired = false

  // Updated each frame as posRef moves
  readonly hitPos: Vector3
  readonly hitRange: number
  private readonly fwdX: number
  private readonly fwdZ: number

  /** Called once at ~45% through the swing: (worldPos, rangeMetres) */
  onHitCheck: ((pos: Vector3, range: number) => void) | null = null

  constructor(
    scene: Scene,
    // Pass the LIVE Vector3 — sword tracks the wielder each frame
    private readonly posRef: Vector3,
    alpha: number,
    readonly swingScale: number,   // 1.0 warrior, 0.65 rogue
    private readonly duration: number,
  ) {
    const sw = swingScale

    this.fwdX = -Math.cos(alpha)
    this.fwdZ = -Math.sin(alpha)

    // Correct yaw so local +Z of the pivot faces the character's forward direction
    const facingYaw = Math.atan2(this.fwdX, this.fwdZ)

    this.hitRange = 2.0 * sw
    this.hitPos = new Vector3(
      posRef.x + this.fwdX * this.hitRange * 0.55,
      posRef.y + 1.1,
      posRef.z + this.fwdZ * this.hitRange * 0.55,
    )

    // ── Outer yaw node — anchored to player, rotated to face forward ──────
    this.yawPivot = new TransformNode('swingYaw', scene)
    this.yawPivot.position.copyFrom(posRef)
    this.yawPivot.rotation.y = facingYaw

    // ── Inner swing node — child; offset forward in local space ───────────
    this.swingPivot = new TransformNode('swingPitch', scene)
    this.swingPivot.parent = this.yawPivot
    // z > 0 = in front of character (yawPivot's local +Z = forward)
    this.swingPivot.position.set(0, 1.1, 0.35 * sw)
    this.swingPivot.rotation.x = -1.2   // sword starts raised/behind

    // ── Blade ──────────────────────────────────────────────────────────────
    const blade = MeshBuilder.CreateBox('blade', {
      width:  0.065 * sw,
      height: 1.55  * sw,
      depth:  0.022,
    }, scene)
    blade.parent   = this.swingPivot
    blade.position.y = 0.8 * sw
    const bladeM = new StandardMaterial('bladeM_' + Math.random(), scene)
    bladeM.diffuseColor  = new Color3(0.85, 0.90, 1.00)
    bladeM.emissiveColor = new Color3(0.20, 0.30, 0.60)
    bladeM.alpha = 0.95
    blade.material = bladeM
    this.blades.push(blade)

    // ── Cross-guard ────────────────────────────────────────────────────────
    const guard = MeshBuilder.CreateBox('guard', {
      width:  0.38 * sw,
      height: 0.055 * sw,
      depth:  0.07,
    }, scene)
    guard.parent = this.swingPivot
    const guardM = new StandardMaterial('guardM_' + Math.random(), scene)
    guardM.diffuseColor  = new Color3(0.72, 0.55, 0.12)
    guardM.emissiveColor = new Color3(0.28, 0.18, 0.00)
    guard.material = guardM
    this.blades.push(guard)

    // ── Handle ─────────────────────────────────────────────────────────────
    const handle = MeshBuilder.CreateCylinder('handle', {
      height: 0.30 * sw, diameter: 0.048 * sw, tessellation: 8,
    }, scene)
    handle.parent    = this.swingPivot
    handle.position.y = -0.17 * sw
    const handleM = new StandardMaterial('handleM_' + Math.random(), scene)
    handleM.diffuseColor = new Color3(0.32, 0.16, 0.04)
    handle.material = handleM
    this.blades.push(handle)
  }

  update(dt: number): boolean {
    this.elapsed += dt
    const t = Math.min(1, this.elapsed / this.duration)

    // Track wielder — update outer yaw node every frame
    this.yawPivot.position.copyFrom(this.posRef)

    // Sweep pitch: raised (-1.2) → forward-down (+1.3) — top-down slash
    this.swingPivot.rotation.x = -1.2 + 2.5 * t

    // Keep hit position tracking the wielder
    this.hitPos.set(
      this.posRef.x + this.fwdX * this.hitRange * 0.55,
      this.posRef.y + 1.1,
      this.posRef.z + this.fwdZ * this.hitRange * 0.55,
    )

    if (!this.hitFired && t >= 0.45) {
      this.hitFired = true
      this.onHitCheck?.(this.hitPos, this.hitRange)
    }
    return this.elapsed >= this.duration
  }

  dispose() {
    this.blades.forEach(b => { b.material?.dispose(); b.dispose() })
    this.swingPivot.dispose()
    this.yawPivot.dispose()
  }
}

//  Projectile (wizard firebolt / archer arrow) 
class Projectile implements Effect {
  private readonly mesh: Mesh
  private readonly position: Vector3
  private elapsed = 0
  private disposed = false

  /** Return true from onHitCheck to remove the projectile (hit something). */
  onHitCheck: ((pos: Vector3, radius: number) => boolean) | null = null

  /** Called when a firebolt explodes, for area-of-effect damage. */
  onExplode: ((pos: Vector3, splashRadius: number) => void) | null = null

  constructor(
    private readonly scene: Scene,
    startPos: Vector3,
    private readonly dir: Vector3,
    private readonly speed: number,
    color: Color3,
    radius: number,
    isArrow: boolean,
    private readonly isFirebolt: boolean,
    private readonly maxLife = 3,
  ) {
    this.position = startPos.clone()

    if (isArrow) {
      this.mesh = MeshBuilder.CreateCylinder('arrow', {
        height: 1.1, diameter: 0.07, tessellation: 6,
      }, scene)
      this.mesh.rotation.y = Math.atan2(dir.x, dir.z)
      this.mesh.rotation.x = -Math.asin(Math.max(-1, Math.min(1, dir.y))) + Math.PI / 2
    } else {
      this.mesh = MeshBuilder.CreateSphere('bolt', { diameter: radius * 2, segments: 7 }, scene)
    }

    this.mesh.position.copyFrom(startPos)
    const mat = new StandardMaterial('projMat_' + Math.random(), scene)
    mat.diffuseColor  = color
    mat.emissiveColor = color.scale(0.65)
    this.mesh.material = mat
  }

  update(dt: number): boolean {
    if (this.disposed) return true
    this.elapsed += dt
    this.position.addInPlace(this.dir.scale(this.speed * dt))
    this.mesh.position.copyFrom(this.position)

    const hitR = this.isFirebolt ? 0.4 : 0.18
    if (this.onHitCheck?.(this.position, hitR)) {
      this.triggerEnd()
      return true
    }

    // Firebolt detonates on ground
    if (this.isFirebolt && this.position.y < 0.2) {
      this.triggerEnd()
      return true
    }

    const fadeStart = this.maxLife * 0.6
    if (this.elapsed > fadeStart) {
      const a = 1 - (this.elapsed - fadeStart) / (this.maxLife - fadeStart)
      ;(this.mesh.material as StandardMaterial).alpha = Math.max(0, a)
    }

    if (this.elapsed >= this.maxLife) {
      this.triggerEnd()
      return true
    }
    return false
  }

  private triggerEnd() {
    if (this.isFirebolt) {
      spawnExplosion(this.scene, this.position.clone(), 2.5)
      this.onExplode?.(this.position.clone(), 2.5)
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.mesh.dispose()
  }
}

//  AttackSystem 
export class AttackSystem {
  private effects: Effect[] = []
  private cooldown = 0

  /**
   * Called when a weapon makes contact.
   * Return true if something was actually hit at (pos, radius).
   * damage is how much HP to subtract from whatever is hit.
   */
  onHit: ((pos: Vector3, radius: number, damage: number) => boolean) | null = null

  constructor(_scene: Scene) {
    // sword geometry is now built procedurally in SwordSwing
  }

  update(dt: number) {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt)
    for (let i = this.effects.length - 1; i >= 0; i--) {
      if (this.effects[i].update(dt)) {
        this.effects[i].dispose()
        this.effects.splice(i, 1)
      }
    }
  }

  canAttack():       boolean { return this.cooldown <= 0 }
  isSwordSwinging(): boolean { return this.effects.some(e => e instanceof SwordSwing) }

  attack(
    scene: Scene,
    cls: CharacterClass,
    feetPos: Vector3,
    alpha: number,
    beta: number,
  ) {
    if (!this.canAttack()) return
    this.cooldown = COOLDOWN[cls]

    const fwdX = -Math.cos(alpha)
    const fwdZ = -Math.sin(alpha)
    const sb = Math.sin(beta), cb = Math.cos(beta)
    const sa = Math.sin(alpha), ca = Math.cos(alpha)
    const dir3 = new Vector3(-ca * sb, -cb, -sa * sb).normalize()
    const chest = feetPos.clone().addInPlaceFromFloats(0, 1.1, 0)

    switch (cls) {
      case 'warrior': {
        const sw = new SwordSwing(scene, feetPos, alpha, 1.0, 0.20)
        sw.onHitCheck = (pos, range) => { this.onHit?.(pos, range, 2) }
        this.effects.push(sw)
        break
      }
      case 'rogue': {
        const sw = new SwordSwing(scene, feetPos, alpha, 0.65, 0.14)
        sw.onHitCheck = (pos, range) => { this.onHit?.(pos, range, 1) }
        this.effects.push(sw)
        break
      }
      case 'wizard': {
        const pos = chest.clone().addInPlaceFromFloats(fwdX * 0.5, 0, fwdZ * 0.5)
        const p = new Projectile(scene, pos, dir3, 22, new Color3(1, 0.3, 0.05), 0.22, false, true)
        p.onHitCheck = (hitPos, r) => this.onHit?.(hitPos, r, 1) ?? false
        p.onExplode  = (expPos, r) => { this.onHit?.(expPos, r, 1) }
        this.effects.push(p)
        break
      }
      case 'archer': {
        const pos = chest.clone().addInPlaceFromFloats(fwdX * 0.5, 0.1, fwdZ * 0.5)
        const p = new Projectile(scene, pos, dir3, 30, new Color3(0.85, 0.65, 0.2), 0.065, true, false)
        p.onHitCheck = (hitPos, r) => this.onHit?.(hitPos, r, 1) ?? false
        this.effects.push(p)
        break
      }
    }
  }

  dispose() {
    this.effects.forEach(e => e.dispose())
    this.effects.length = 0
  }
}


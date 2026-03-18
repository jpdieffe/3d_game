import '@babylonjs/loaders/glTF'
import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Mesh,
  TransformNode,
  SceneLoader,
} from '@babylonjs/core'
import type { CharacterClass } from './types'

// â”€â”€ Module-level sword template (loaded once, shared by all swings) â”€â”€â”€â”€â”€â”€â”€â”€â”€
let swordRoot: TransformNode | null = null

export async function preloadSword(scene: Scene): Promise<void> {
  if (swordRoot) return
  try {
    const result = await SceneLoader.ImportMeshAsync('', './assets/weapons/', 'sword.glb', scene)
    result.meshes.forEach(m => { m.isVisible = false; m.setEnabled(false) })
    swordRoot = result.meshes[0] as unknown as TransformNode
  } catch (e) {
    console.warn('[attacks] sword.glb not loaded â€“ using geometry fallback', e)
  }
}

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


//  Sword Swing 
// Spawns a sword in front of the player, sweeps it downward in an arc.
// Uses sword.glb when loaded; falls back to a simple blade box.
export class SwordSwing implements Effect {
  private readonly pivot: TransformNode
  private swordClone: TransformNode | null = null
  private fallback: Mesh | null = null
  private elapsed = 0
  private hitFired = false

  readonly hitPos: Vector3
  readonly hitRange: number

  /** Called once at ~45% through the swing: (worldPos, rangeMetres) */
  onHitCheck: ((pos: Vector3, range: number) => void) | null = null

  constructor(
    scene: Scene,
    feetPos: Vector3,
    alpha: number,
    readonly swingScale: number,   // 1.0 warrior, 0.65 rogue
    private readonly duration: number,
  ) {
    const fwdX = -Math.cos(alpha)
    const fwdZ = -Math.sin(alpha)

    this.hitRange = 2.2 * swingScale
    this.hitPos   = new Vector3(
      feetPos.x + fwdX * this.hitRange * 0.6,
      feetPos.y + 1.1,
      feetPos.z + fwdZ * this.hitRange * 0.6,
    )

    this.pivot = new TransformNode('swingPivot', scene)
    this.pivot.position.copyFrom(this.hitPos)
    this.pivot.rotation.y = alpha
    this.pivot.rotation.x = -1.1   // sword starts raised

    if (swordRoot) {
      const clone = swordRoot.clone('swordSwing', this.pivot, false)
      if (clone) {
        clone.setEnabled(true)
        clone.scaling.setAll(swingScale)
        clone.getChildMeshes(false).forEach(m => { m.setEnabled(true); m.isVisible = true })
        this.swordClone = clone
      }
    }

    // Fallback blade box (always shown when GLB not ready yet)
    if (!this.swordClone) {
      const blade = MeshBuilder.CreateBox('swordBlade', {
        width:  0.08 * swingScale,
        height: 1.4  * swingScale,
        depth:  0.04,
      }, scene)
      blade.parent = this.pivot
      blade.position.set(0, 0.5 * swingScale, 0)
      const mat = new StandardMaterial('bladeMat_' + Math.random(), scene)
      mat.diffuseColor  = new Color3(0.80, 0.88, 1.0)
      mat.emissiveColor = new Color3(0.15, 0.25, 0.5)
      mat.alpha = 0.92
      blade.material = mat
      this.fallback = blade
    }
  }

  update(dt: number): boolean {
    this.elapsed += dt
    const t = Math.min(1, this.elapsed / this.duration)
    this.pivot.rotation.x = -1.1 + 2.1 * t   // sweep from raised to forward-down

    if (!this.hitFired && t >= 0.45) {
      this.hitFired = true
      this.onHitCheck?.(this.hitPos, this.hitRange)
    }
    return this.elapsed >= this.duration
  }

  dispose() {
    this.swordClone?.getChildMeshes(false).forEach(m => m.dispose())
    this.swordClone?.dispose()
    this.fallback?.dispose()
    this.pivot.dispose()
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

  constructor(scene: Scene) {
    preloadSword(scene)
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
        const sw = new SwordSwing(scene, feetPos, alpha, 1.0, 0.40)
        sw.onHitCheck = (pos, range) => { this.onHit?.(pos, range, 2) }
        this.effects.push(sw)
        break
      }
      case 'rogue': {
        const sw = new SwordSwing(scene, feetPos, alpha, 0.65, 0.28)
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

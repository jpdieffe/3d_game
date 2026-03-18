import '@babylonjs/loaders/glTF'
import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  TransformNode,
  SceneLoader,
  AbstractMesh,
  Mesh,
} from '@babylonjs/core'
import { SwordSwing, spawnExplosion } from './attacks'
import type { HealthSystem } from './health'
import type { AttackSystem }  from './attacks'

// ── Monster type definitions ─────────────────────────────────────────────────
export type MonsterType = 'slime' | 'spider' | 'wolf' | 'goblin' | 'imp' | 'orc'

interface MonsterDef {
  hp:              number
  speed:           number
  aggroRadius:     number
  attackRadius:    number
  attackCooldown:  number
  damage:          number
  projColor:       Color3
  projSpeed:       number
  projRadius:      number
  flies:           boolean
  flyHeight:       number
  isMelee:         boolean   // true = Orc sword swing
  isFireball:      boolean   // true = Imp; projectile explodes on hit
}

const DEFS: Record<MonsterType, MonsterDef> = {
  slime:  { hp: 3, speed: 1.8, aggroRadius: 10, attackRadius: 8,  attackCooldown: 2.2, damage: 1, projColor: new Color3(0.3, 0.9, 0.2),   projSpeed: 7,  projRadius: 0.28, flies: false, flyHeight: 0,   isMelee: false, isFireball: false },
  spider: { hp: 2, speed: 3.5, aggroRadius: 14, attackRadius: 10, attackCooldown: 1.5, damage: 1, projColor: new Color3(0.9, 0.9, 0.95),  projSpeed: 12, projRadius: 0.18, flies: false, flyHeight: 0,   isMelee: false, isFireball: false },
  wolf:   { hp: 4, speed: 5.5, aggroRadius: 18, attackRadius: 7,  attackCooldown: 3.0, damage: 2, projColor: new Color3(0.6, 0.6, 1.0),   projSpeed: 15, projRadius: 0.2,  flies: false, flyHeight: 0,   isMelee: false, isFireball: false },
  goblin: { hp: 2, speed: 3.2, aggroRadius: 16, attackRadius: 12, attackCooldown: 0.9, damage: 1, projColor: new Color3(0.5, 0.9, 0.2),   projSpeed: 11, projRadius: 0.16, flies: false, flyHeight: 0,   isMelee: false, isFireball: false },
  imp:    { hp: 2, speed: 4.0, aggroRadius: 22, attackRadius: 14, attackCooldown: 1.2, damage: 1, projColor: new Color3(1.0, 0.3, 0.05),  projSpeed: 18, projRadius: 0.22, flies: true,  flyHeight: 3.5, isMelee: false, isFireball: true  },
  orc:    { hp: 8, speed: 2.2, aggroRadius: 14, attackRadius: 2.8,attackCooldown: 1.8, damage: 2, projColor: new Color3(0.8, 0.4, 0.0),   projSpeed: 0,  projRadius: 0,    flies: false, flyHeight: 0,   isMelee: true,  isFireball: false },
}

// ── Monster projectile ────────────────────────────────────────────────────────
class MonsterProjectile {
  private readonly mesh: Mesh
  private readonly position: Vector3
  private elapsed = 0
  private disposed = false
  private readonly maxLife = 4.0

  constructor(
    private readonly scene: Scene,
    startPos: Vector3,
    private readonly dir: Vector3,
    private readonly speed: number,
    color: Color3,
    radius: number,
    private readonly onHitPlayer: (pos: Vector3) => boolean,
    private readonly isFireball: boolean,
  ) {
    this.position = startPos.clone()
    this.mesh = MeshBuilder.CreateSphere('mproj', { diameter: radius * 2, segments: 6 }, scene)
    this.mesh.position.copyFrom(startPos)
    const mat = new StandardMaterial('mprojMat_' + Math.random(), scene)
    mat.diffuseColor  = color
    mat.emissiveColor = color.scale(0.5)
    this.mesh.material = mat
  }

  // Returns true when this projectile should be removed
  update(dt: number): boolean {
    if (this.disposed) return true
    this.elapsed += dt
    this.position.addInPlace(this.dir.scale(this.speed * dt))
    this.mesh.position.copyFrom(this.position)

    if (this.onHitPlayer(this.position)) {
      if (this.isFireball) spawnExplosion(this.scene, this.position.clone(), 1.8)
      return true
    }

    if (this.position.y < 0) {
      if (this.isFireball) spawnExplosion(this.scene, this.position.clone(), 1.8)
      return true
    }

    return this.elapsed >= this.maxLife
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.mesh.dispose()
  }
}

// ── Monster ───────────────────────────────────────────────────────────────────
class Monster {
  readonly def: MonsterDef
  position: Vector3
  velocity  = Vector3.Zero()
  hp: number
  alive     = true

  private root:         TransformNode | null = null
  private yOffset       = 0
  private facingY       = 0
  private atkCooldown:  number

  private projectiles:  MonsterProjectile[] = []
  private swings:       SwordSwing[]        = []

  constructor(
    private readonly scene: Scene,
    readonly type: MonsterType,
    spawnPos: Vector3,
  ) {
    this.def        = DEFS[type]
    this.position   = spawnPos.clone()
    this.hp         = this.def.hp
    this.atkCooldown = Math.random() * this.def.attackCooldown   // stagger initial attacks
    this.loadModel()
  }

  private async loadModel() {
    const file = `${this.type}.glb`
    try {
      const result = await SceneLoader.ImportMeshAsync('', './assets/monsters/', file, this.scene)
      const root = new TransformNode(`mon_${this.type}_root`, this.scene)
      result.meshes.forEach((m: AbstractMesh) => { if (!m.parent) m.parent = root })
      root.scaling.setAll(2)
      root.position.copyFrom(this.position)

      // Auto-measure feet offset (same technique as Player)
      this.scene.incrementRenderId()
      result.meshes.forEach((m: AbstractMesh) => m.computeWorldMatrix(true))
      let minY = Infinity
      for (const m of result.meshes) {
        const wMin = m.getBoundingInfo().boundingBox.minimumWorld.y
        if (wMin < minY) minY = wMin
      }
      this.yOffset = minY === Infinity ? 0 : -minY

      this.root = root
    } catch {
      // Fallback: coloured box
      const box = MeshBuilder.CreateBox(`mon_fb_${this.type}`, { size: 2.0 }, this.scene)
      const mat = new StandardMaterial(`mon_fb_mat_${this.type}`, this.scene)
      mat.diffuseColor = this.def.projColor
      box.material = mat
      const root = new TransformNode(`mon_${this.type}_fb_root`, this.scene)
      box.parent = root
      box.position.y = 0.5
      this.yOffset = 0
      this.root = root
    }
  }

  takeDamage(amount: number): boolean {
    if (!this.alive) return true
    this.hp -= amount
    if (this.hp <= 0) this.kill()
    return !this.alive
  }

  private kill() {
    this.alive = false
    this.root?.getChildMeshes(false).forEach(m => m.dispose())
    this.root?.dispose()
    this.root = null
    this.projectiles.forEach(p => p.dispose())
    this.swings.forEach(s => s.dispose())
    this.projectiles = []
    this.swings = []
  }

  update(
    dt: number,
    playerPos: Vector3,
    playerHealth: HealthSystem,
    playerAttackSys: AttackSystem,
  ) {
    if (!this.alive) return

    // Tick projectiles
    this.projectiles = this.projectiles.filter(p => {
      if (p.update(dt)) { p.dispose(); return false }
      return true
    })
    // Tick orc sword swings
    this.swings = this.swings.filter(s => {
      if (s.update(dt)) { s.dispose(); return false }
      return true
    })

    const toPlayer  = playerPos.subtract(this.position)
    const dist      = toPlayer.length()
    const toPlayerN = toPlayer.normalizeToNew()

    if (dist <= this.def.aggroRadius) {
      // Chase
      if (dist > this.def.attackRadius * 0.9) {
        this.velocity.x = toPlayerN.x * this.def.speed
        this.velocity.z = toPlayerN.z * this.def.speed
      } else {
        this.velocity.x = 0
        this.velocity.z = 0
      }

      // Face player
      this.facingY = Math.atan2(toPlayer.x, toPlayer.z)

      // Attack
      this.atkCooldown -= dt
      if (dist <= this.def.attackRadius && this.atkCooldown <= 0) {
        this.atkCooldown = this.def.attackCooldown
        this.doAttack(playerPos, playerHealth, playerAttackSys)
      }
    } else {
      // Idle decelerate
      this.velocity.x *= 0.92
      this.velocity.z *= 0.92
    }

    // Gravity or flying
    if (this.def.flies) {
      // Hover at flyHeight above start Y
      this.velocity.y = (this.def.flyHeight - this.position.y) * 5
    } else {
      this.velocity.y -= 28 * dt
      if (this.velocity.y < -30) this.velocity.y = -30
    }

    // Integrate
    this.position.addInPlace(this.velocity.scale(dt))

    // Ground clamp (non-flyers)
    if (!this.def.flies && this.position.y < 0) {
      this.position.y = 0
      this.velocity.y = 0
    }

    // Sync mesh
    if (this.root) {
      this.root.position.set(
        this.position.x,
        this.position.y + this.yOffset,
        this.position.z,
      )
      this.root.rotation.y = this.facingY
    }
  }

  private doAttack(
    playerPos: Vector3,
    playerHealth: HealthSystem,
    playerAttackSys: AttackSystem,
  ) {
    if (this.def.isMelee) {
      // Orc sword swing
      const alpha = -Math.atan2(
        playerPos.x - this.position.x,
        playerPos.z - this.position.z,
      ) - Math.PI
      const swing = new SwordSwing(this.scene, this.position, alpha, 0.9, 0.5)
      swing.onHitCheck = (pos, range) => {
        const d = Vector3.Distance(pos, playerPos)
        if (d > range + 0.6) return

        // Sword clash: player is also swinging AND close enough
        if (
          playerAttackSys.isSwordSwinging() &&
          Vector3.Distance(this.position, playerPos) < 3.5
        ) {
          spawnExplosion(this.scene, playerPos.clone().addInPlaceFromFloats(0, 1, 0), 0.7)
          return  // damage blocked
        }

        playerHealth.takeDamage(this.def.damage)
      }
      this.swings.push(swing)
      return
    }

    // Ranged projectile
    const spawnY   = this.position.y + this.yOffset + (this.def.flies ? 0 : 1.0)
    const spawnPos = new Vector3(this.position.x, spawnY, this.position.z)
    const targetPt = new Vector3(playerPos.x, playerPos.y + 1.0, playerPos.z)
    const dir      = targetPt.subtract(spawnPos).normalize()

    const dmg = this.def.damage
    this.projectiles.push(new MonsterProjectile(
      this.scene,
      spawnPos,
      dir,
      this.def.projSpeed,
      this.def.projColor,
      this.def.projRadius,
      (projPos) => {
        // Test against body centre (feet + 0.9) so shots actually land on the player
        const playerCenter = new Vector3(playerPos.x, playerPos.y + 0.9, playerPos.z)
        if (Vector3.Distance(projPos, playerCenter) < 0.6 + this.def.projRadius) {
          playerHealth.takeDamage(dmg)
          return true
        }
        return false
      },
      this.def.isFireball,
    ))
  }

  dispose() {
    this.kill()
  }
}

// ── MonsterManager ────────────────────────────────────────────────────────────
const INITIAL_TYPES: MonsterType[] = ['slime', 'spider', 'wolf', 'goblin', 'imp', 'orc', 'slime', 'goblin']
const ALL_TYPES:     MonsterType[] = ['slime', 'spider', 'wolf', 'goblin', 'imp', 'orc']

export class MonsterManager {
  private monsters:      Monster[] = []
  private respawnTimer = 0
  private readonly RESPAWN_INTERVAL = 20   // seconds between spawns

  constructor(private readonly scene: Scene) {
    this.spawnInitial()
  }

  private spawnInitial() {
    for (let i = 0; i < INITIAL_TYPES.length; i++) {
      const angle  = (i / INITIAL_TYPES.length) * Math.PI * 2
      const radius = 22 + Math.random() * 10
      const pos    = new Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
      this.monsters.push(new Monster(this.scene, INITIAL_TYPES[i], pos))
    }
  }

  private spawnOne() {
    const type   = ALL_TYPES[Math.floor(Math.random() * ALL_TYPES.length)]
    const angle  = Math.random() * Math.PI * 2
    const radius = 24 + Math.random() * 10
    const pos    = new Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
    this.monsters.push(new Monster(this.scene, type, pos))
  }

  /**
   * Check if a player attack (centred at pos, with given radius) hits any monster.
   * Deals damage to all monsters within range; returns true if at least one was hit.
   */
  checkHit(pos: Vector3, radius: number, damage: number): boolean {
    let hit = false
    for (const m of this.monsters) {
      if (!m.alive) continue
      if (Vector3.Distance(pos, m.position) < radius + 0.9) {
        m.takeDamage(damage)
        hit = true
      }
    }
    return hit
  }

  update(
    dt: number,
    playerPos: Vector3,
    playerHealth: HealthSystem,
    playerAttackSys: AttackSystem,
  ) {
    for (const m of this.monsters) {
      if (m.alive) m.update(dt, playerPos, playerHealth, playerAttackSys)
    }

    // Remove dead monsters from the list
    this.monsters = this.monsters.filter(m => m.alive)

    // Respawn
    this.respawnTimer += dt
    if (this.respawnTimer >= this.RESPAWN_INTERVAL) {
      this.respawnTimer = 0
      this.spawnOne()
    }
  }

  dispose() {
    this.monsters.forEach(m => m.dispose())
    this.monsters = []
  }
}

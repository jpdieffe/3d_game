/** Shape of a building in the world */
export interface BuildingDef {
  x: number
  z: number
  width: number
  depth: number
  height: number
}

/** Player state synced over the network */
export interface PlayerState {
  x: number
  y: number   // feet Y position
  z: number
  ry: number  // horizontal rotation (camera alpha)
  cls: CharacterClass
}

/** Network message envelope */
export type NetMessage =
  | { type: 'state'; state: PlayerState }
  | { type: 'attack'; cls: CharacterClass; alpha: number; beta: number }

/** Playable character classes */
export type CharacterClass = 'warrior' | 'wizard' | 'rogue' | 'archer'

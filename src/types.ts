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
}

/** Network message envelope */
export type NetMessage = { type: 'state'; state: PlayerState }

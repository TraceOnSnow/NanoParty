import { RoomRuntime, type RuntimeDeps } from "./RoomRuntime.ts";

/**
 * Process-wide registry of live room runtimes, loaded lazily from the database.
 * Runtimes live as long as the process (rooms are few and small); they are independent
 * of connection lifecycles, so a room keeps running while everybody is reconnecting.
 */
export class RoomManager {
  private readonly runtimes = new Map<string, Promise<RoomRuntime | null>>();

  constructor(private readonly deps: RuntimeDeps) {}

  get(roomId: string): Promise<RoomRuntime | null> {
    let runtime = this.runtimes.get(roomId);
    if (!runtime) {
      runtime = RoomRuntime.load(this.deps, roomId).catch((err) => {
        this.runtimes.delete(roomId);
        throw err;
      });
      this.runtimes.set(roomId, runtime);
      // Do not cache "not found": the room may be created later.
      runtime.then((rt) => !rt && this.runtimes.delete(roomId)).catch(() => {});
    }
    return runtime;
  }

  async disposeAll() {
    for (const p of this.runtimes.values()) (await p.catch(() => null))?.dispose();
    this.runtimes.clear();
  }
}

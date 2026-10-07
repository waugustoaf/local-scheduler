import type { TaskModule } from "./types.ts";

export class Registry {
  private modules = new Map<string, TaskModule<any>>();
  register(module: TaskModule<any>): this {
    if (!/^[a-z][a-z0-9_]*$/.test(module.id))
      throw new Error("Identificador de módulo inválido.");
    if (this.modules.has(module.id))
      throw new Error(`Módulo ${module.id} já registrado.`);
    this.modules.set(module.id, module);
    return this;
  }
  get(id: string): TaskModule<any> {
    const module = this.modules.get(id);
    if (!module) throw new Error(`Módulo ${id} não disponível.`);
    return module;
  }
  list() {
    return [...this.modules.values()].map(({ id, label, version }) => ({
      id,
      label,
      version,
    }));
  }
}

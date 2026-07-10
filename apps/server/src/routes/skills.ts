import type { FastifyInstance } from "fastify";
import { deleteSkill, importSkill, listSkills, setSkillEnabled } from "../skills/index.js";
import { parseSkillFile } from "../skills/import-file.js";

export async function skillRoutes(app: FastifyInstance) {
  app.get("/api/skills", async () => listSkills());

  app.post<{ Body: { name?: string; description?: string; content?: string } }>("/api/skills", async (req, reply) => {
    try {
      return importSkill({
        name: req.body?.name ?? "",
        description: req.body?.description,
        content: req.body?.content ?? "",
      });
    } catch (error: any) {
      return reply.badRequest(error?.message ?? String(error));
    }
  });

  app.post("/api/skills/import", async (req, reply) => {
    try {
      const file = await req.file({ limits: { files: 1, fileSize: 2 * 1024 * 1024 } });
      if (!file) return reply.badRequest("skill file is required");
      const input = await file.toBuffer();
      if (file.file.truncated) return reply.payloadTooLarge("skill file exceeds the 2 MB limit");
      return importSkill(parseSkillFile(file.filename, input));
    } catch (error: any) {
      if (error?.code === "FST_REQ_FILE_TOO_LARGE") return reply.payloadTooLarge("skill file exceeds the 2 MB limit");
      return reply.badRequest(error?.message ?? String(error));
    }
  });

  app.patch<{ Params: { id: string }; Body: { enabled?: boolean } }>("/api/skills/:id", async (req, reply) => {
    if (typeof req.body?.enabled !== "boolean") return reply.badRequest("enabled is required");
    try {
      const skill = setSkillEnabled(req.params.id, req.body.enabled);
      return skill ?? reply.notFound();
    } catch (error: any) {
      return reply.badRequest(error?.message ?? String(error));
    }
  });

  app.delete<{ Params: { id: string } }>("/api/skills/:id", async (req, reply) => {
    if (!deleteSkill(req.params.id)) return reply.notFound();
    return { ok: true };
  });
}

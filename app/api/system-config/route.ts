// app/api/system-config/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSystemConfig, upsertSystemConfig } from "../../lib/db";

const UpdateSystemConfigSchema = z.object({
    system_prompt: z.string().optional(),
    model: z.string().optional(),
    provider: z.string().optional(),
    theme: z.enum(["light", "dark", "system"]).optional(),
    workspace_enabled: z.boolean().optional(),
    extras: z.record(z.string(), z.unknown()).optional(),
});

/**
 * GET /api/system-config
 * Returns the current system configuration (singleton).
 */
export async function GET() {
    try {
        const config = await getSystemConfig();
        return NextResponse.json({ data: config });
    } catch (error) {
        console.error("[System Config API] GET error:", error);
        return NextResponse.json(
            { error: "Failed to load system config" },
            { status: 500 }
        );
    }
}

/**
 * PUT /api/system-config
 * Upsert the singleton system configuration.
 */
export async function PUT(req: NextRequest) {
    try {
        const json = await req.json();
        const parsed = UpdateSystemConfigSchema.safeParse(json);
        if (!parsed.success) {
            return NextResponse.json(
                { error: `Invalid request body: ${parsed.error.message}` },
                { status: 400 }
            );
        }

        const updated = await upsertSystemConfig(parsed.data);
        return NextResponse.json({ data: updated });
    } catch (error) {
        console.error("[System Config API] PUT error:", error);
        return NextResponse.json(
            { error: "Failed to update system config" },
            { status: 500 }
        );
    }
}

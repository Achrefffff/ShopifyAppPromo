import type { LoaderFunctionArgs } from "react-router";
import prisma from "../../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    try {
        // Check database connectivity
        await prisma.$queryRaw`SELECT 1`;

        return new Response(
            JSON.stringify({
                status: "healthy",
                timestamp: new Date().toISOString(),
                database: "connected",
            }),
            {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }
        );
    } catch (error) {
        console.error("Health check failed:", error);
        return new Response(
            JSON.stringify({
                status: "unhealthy",
                timestamp: new Date().toISOString(),
                database: "disconnected",
            }),
            {
                status: 503,
                headers: { "Content-Type": "application/json" },
            }
        );
    }
};
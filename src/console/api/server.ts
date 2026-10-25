// Backward compatibility entry point for console server
// Forwarding directly to backend/api/server.ts
export * from "../../backend/api/server";
import { startServer } from "../../backend/api/server";

if (import.meta.main) startServer();

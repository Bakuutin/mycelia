import { Auth } from "@/lib/auth/core.server.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface MCPSession {
  id: string;
  auth: Auth;
  server: McpServer;
  transport?: any; // SSEServerTransport when available
  createdAt: Date;
  lastUsed: Date;
}

class SessionManager {
  private sessions = new Map<string, MCPSession>();
  private readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

  generateSessionId(): string {
    return crypto.randomUUID();
  }

  createSession(auth: Auth, server: McpServer): MCPSession {
    const sessionId = this.generateSessionId();
    const session: MCPSession = {
      id: sessionId,
      auth,
      server,
      createdAt: new Date(),
      lastUsed: new Date(),
    };
    
    this.sessions.set(sessionId, session);
    this.cleanupExpiredSessions();
    
    return session;
  }

  getSession(sessionId: string): MCPSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    
    // Check if session has expired
    if (Date.now() - session.lastUsed.getTime() > this.SESSION_TIMEOUT) {
      this.deleteSession(sessionId);
      return null;
    }
    
    session.lastUsed = new Date();
    return session;
  }

  deleteSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session?.transport) {
      try {
        session.transport.close();
      } catch (error) {
        console.error("Error closing transport:", error);
      }
    }
    return this.sessions.delete(sessionId);
  }

  setTransport(sessionId: string, transport: any): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.transport = transport;
    }
  }

  private cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastUsed.getTime() > this.SESSION_TIMEOUT) {
        this.deleteSession(sessionId);
      }
    }
  }

  getAllSessions(): MCPSession[] {
    return Array.from(this.sessions.values());
  }
}

export const sessionManager = new SessionManager();
import {
  BarChart3,
  Bot,
  MessageCircle,
  Paperclip,
  PenLine,
  Search,
  Send,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
  isWelcome?: boolean;
};

type Capability = {
  icon: typeof BarChart3;
  text: string;
};

const COLORS = {
  brand: "#6B5BFF",
  brandLight: "#EEF0FF",
  brandHover: "#5A4AE0",
  bg: "#F7F8FA",
  white: "#FFFFFF",
  textPrimary: "#1D2129",
  textSecondary: "#4E5969",
  textTertiary: "#86909C",
  border: "#E5E6EB",
  bubbleAssistant: "#F2F3F5",
  bubbleUser: "#6B5BFF",
  inputBg: "#F7F8FA",
};

const QUICK_QUESTIONS = [
  "给我几个爆款标题模板",
  "分析一下大健康赛道的内容趋势",
  "AI营销领域用户最关心什么痛点？",
];

const CAPABILITIES: Capability[] = [
  { icon: BarChart3, text: "查询爆款内容和分析趋势" },
  { icon: Target, text: "分析用户画像和行业方向" },
  { icon: PenLine, text: "提供标题模板和创作建议" },
  { icon: Search, text: "语义搜索相关内容" },
];

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderMarkdown(text: string): string {
  if (!text) return "";

  let html = escapeHtml(text);
  html = html.replace(
    /```(\w*)\n?([\s\S]*?)```/g,
    '<pre style="background:#1D2129;color:#C9D1D9;padding:12px 16px;border-radius:8px;overflow-x:auto;margin:8px 0;font-size:13px;line-height:1.6"><code>$2</code></pre>',
  );
  html = html.replace(
    /`([^`]+)`/g,
    '<code style="background:#F2F3F5;padding:2px 6px;border-radius:4px;font-size:13px;color:#6B5BFF">$1</code>',
  );
  html = html.replace(/^### (.+)$/gm, '<h4 style="margin:12px 0 6px;font-size:15px;font-weight:600;color:#1D2129">$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3 style="margin:14px 0 8px;font-size:16px;font-weight:600;color:#1D2129">$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2 style="margin:16px 0 10px;font-size:18px;font-weight:700;color:#1D2129">$1</h2>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong style="font-weight:600;color:#1D2129">$1</strong>');
  html = html.replace(/^- (.+)$/gm, '<div style="padding-left:16px;text-indent:-12px;margin:2px 0">• $1</div>');
  html = html.replace(/^(\d+)\. (.+)$/gm, '<div style="padding-left:20px;text-indent:-16px;margin:2px 0">$1. $2</div>');
  return html.replace(/\n/g, "<br/>");
}

function extractCozeDelta(data: Record<string, unknown>, eventName: string) {
  const content = typeof data.content === "string" ? data.content : "";
  const type = typeof data.type === "string" ? data.type : "";
  const event = eventName || (typeof data.event === "string" ? data.event : "");

  if (!content) return "";
  if (event.includes("message.delta")) return content;
  if (event) return "";
  if (!event && (type === "answer" || type === "tool_response")) return content;
  return "";
}

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [hasWelcome, setHasWelcome] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();
    if (!hasWelcome) {
      setHasWelcome(true);
      setMessages([{ role: "assistant", isWelcome: true, content: "" }]);
    }
  }, [isOpen, hasWelcome]);

  async function handleSend(text?: string) {
    const userMessage = (text || input).trim();
    if (!userMessage || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setLoading(true);
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          conversationId,
          userId: "web-user",
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("响应流为空");

      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
            continue;
          }
          if (!line.startsWith("data:")) continue;
          const dataStr = line.slice(5).trim();
          if (!dataStr || dataStr === "[DONE]") continue;

          try {
            const data = JSON.parse(dataStr);
            if (typeof data.conversation_id === "string" && !conversationId) {
              setConversationId(data.conversation_id);
            }

            const delta = extractCozeDelta(data, currentEvent);
            if (delta) {
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  role: "assistant",
                  content: updated[updated.length - 1].content + delta,
                };
                return updated;
              });
            }
          } catch {
            // Coze SSE may include non-JSON keepalive lines.
          }
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: "assistant",
          content: `抱歉，出错了：${err instanceof Error ? err.message : String(err)}。请稍后重试。`,
        };
        return updated;
      });
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        style={{
          position: "fixed",
          right: "24px",
          bottom: "24px",
          width: "56px",
          height: "56px",
          borderRadius: "50%",
          backgroundColor: COLORS.brand,
          color: COLORS.white,
          border: "none",
          cursor: "pointer",
          boxShadow: "0 4px 16px rgba(107, 91, 255, 0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
          transition: "transform 0.2s, box-shadow 0.2s, background-color 0.2s",
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.transform = "scale(1.08)";
          event.currentTarget.style.boxShadow = "0 6px 20px rgba(107, 91, 255, 0.5)";
          event.currentTarget.style.backgroundColor = COLORS.brandHover;
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.transform = "scale(1)";
          event.currentTarget.style.boxShadow = "0 4px 16px rgba(107, 91, 255, 0.4)";
          event.currentTarget.style.backgroundColor = COLORS.brand;
        }}
        aria-label="打开智能体对话"
        title="打开智能体对话"
        type="button"
      >
        <MessageCircle size={25} />
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        right: "16px",
        bottom: "16px",
        width: "min(400px, calc(100vw - 32px))",
        height: "min(600px, calc(100vh - 32px))",
        backgroundColor: COLORS.bg,
        borderRadius: "16px",
        boxShadow: "0 12px 40px rgba(0, 0, 0, 0.15)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        zIndex: 9999,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "12px 16px",
          backgroundColor: COLORS.white,
          borderBottom: `1px solid ${COLORS.border}`,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "8px",
            backgroundColor: COLORS.brand,
            color: COLORS.white,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginRight: "10px",
            flexShrink: 0,
          }}
        >
          <BarChart3 size={19} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: "15px",
              fontWeight: 600,
              color: COLORS.textPrimary,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            GEO小红书内容分析智能体
          </div>
          <div style={{ fontSize: "12px", color: COLORS.textTertiary }}>{loading ? "正在思考..." : "在线"}</div>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          style={{
            width: "32px",
            height: "32px",
            border: "none",
            backgroundColor: "transparent",
            cursor: "pointer",
            color: COLORS.textTertiary,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "8px",
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.backgroundColor = COLORS.bubbleAssistant;
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.backgroundColor = "transparent";
          }}
          aria-label="关闭对话"
          title="关闭对话"
          type="button"
        >
          <X size={18} />
        </button>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        {messages.map((msg, index) => {
          if (msg.isWelcome) {
            return (
              <div key={index} style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "8px 0 16px" }}>
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "12px",
                    backgroundColor: COLORS.brand,
                    color: COLORS.white,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: "12px",
                  }}
                >
                  <Bot size={25} />
                </div>
                <div
                  style={{
                    fontSize: "16px",
                    fontWeight: 600,
                    color: COLORS.textPrimary,
                    marginBottom: "16px",
                  }}
                >
                  GEO小红书内容分析智能体
                </div>
                <div
                  style={{
                    width: "100%",
                    backgroundColor: COLORS.bubbleAssistant,
                    borderRadius: "12px",
                    padding: "16px",
                  }}
                >
                  <div style={{ fontSize: "14px", color: COLORS.textPrimary, marginBottom: "12px" }}>
                    你好！我是 GEO 小红书内容分析智能体，我可以帮你：
                  </div>
                  {CAPABILITIES.map((cap) => {
                    const Icon = cap.icon;
                    return (
                      <div
                        key={cap.text}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          padding: "6px 0",
                          fontSize: "14px",
                          color: COLORS.textSecondary,
                        }}
                      >
                        <Icon size={16} style={{ marginRight: "8px", color: COLORS.brand }} />
                        {cap.text}
                      </div>
                    );
                  })}
                  <div
                    style={{
                      fontSize: "13px",
                      color: COLORS.textTertiary,
                      marginTop: "12px",
                      paddingTop: "12px",
                      borderTop: `1px solid ${COLORS.border}`,
                    }}
                  >
                    直接问我就行，比如「最近哪些笔记最火？」
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    width: "100%",
                    marginTop: "12px",
                  }}
                >
                  {QUICK_QUESTIONS.map((question) => (
                    <button
                      key={question}
                      onClick={() => handleSend(question)}
                      disabled={loading}
                      style={{
                        padding: "10px 14px",
                        backgroundColor: COLORS.white,
                        border: `1px solid ${COLORS.border}`,
                        borderRadius: "10px",
                        cursor: loading ? "not-allowed" : "pointer",
                        fontSize: "13px",
                        color: COLORS.textSecondary,
                        textAlign: "left",
                        transition: "all 0.15s",
                        opacity: loading ? 0.5 : 1,
                      }}
                      onMouseEnter={(event) => {
                        if (!loading) {
                          event.currentTarget.style.borderColor = COLORS.brand;
                          event.currentTarget.style.color = COLORS.brand;
                        }
                      }}
                      onMouseLeave={(event) => {
                        event.currentTarget.style.borderColor = COLORS.border;
                        event.currentTarget.style.color = COLORS.textSecondary;
                      }}
                      type="button"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            );
          }

          const isUser = msg.role === "user";
          return (
            <div key={index} style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
              <div
                style={{
                  maxWidth: "85%",
                  padding: "10px 14px",
                  borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                  backgroundColor: isUser ? COLORS.bubbleUser : COLORS.bubbleAssistant,
                  color: isUser ? COLORS.white : COLORS.textPrimary,
                  fontSize: "14px",
                  lineHeight: "1.6",
                  wordBreak: "break-word",
                  whiteSpace: "pre-wrap",
                }}
              >
                {isUser ? (
                  msg.content
                ) : msg.content ? (
                  <span dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                ) : (
                  <span style={{ color: COLORS.textTertiary }}>
                    <span
                      style={{
                        display: "inline-block",
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        backgroundColor: COLORS.brand,
                        marginRight: "4px",
                        animation: "chat-widget-pulse 1.4s infinite",
                      }}
                    />
                    <span
                      style={{
                        display: "inline-block",
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        backgroundColor: COLORS.brand,
                        marginRight: "4px",
                        animation: "chat-widget-pulse 1.4s infinite 0.2s",
                      }}
                    />
                    <span
                      style={{
                        display: "inline-block",
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        backgroundColor: COLORS.brand,
                        animation: "chat-widget-pulse 1.4s infinite 0.4s",
                      }}
                    />
                    <style>
                      {`
                        @keyframes chat-widget-pulse {
                          0%, 60%, 100% { opacity: 0.3; }
                          30% { opacity: 1; }
                        }
                      `}
                    </style>
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <div
        style={{
          padding: "12px 16px",
          backgroundColor: COLORS.white,
          borderTop: `1px solid ${COLORS.border}`,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            backgroundColor: COLORS.inputBg,
            borderRadius: "12px",
            padding: "4px 4px 4px 12px",
          }}
        >
          <button
            style={{
              border: "none",
              backgroundColor: "transparent",
              cursor: "pointer",
              color: COLORS.textTertiary,
              padding: "4px",
              display: "flex",
              alignItems: "center",
            }}
            aria-label="上传文件"
            title="上传文件"
            type="button"
          >
            <Paperclip size={18} />
          </button>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
            placeholder="发送消息..."
            disabled={loading}
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              backgroundColor: "transparent",
              outline: "none",
              fontSize: "14px",
              color: COLORS.textPrimary,
              padding: "8px 0",
            }}
          />
          <button
            onClick={() => handleSend()}
            disabled={loading || !input.trim()}
            style={{
              width: "36px",
              height: "36px",
              border: "none",
              borderRadius: "8px",
              backgroundColor: input.trim() && !loading ? COLORS.brand : COLORS.border,
              color: COLORS.white,
              cursor: input.trim() && !loading ? "pointer" : "not-allowed",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background-color 0.15s",
              flexShrink: 0,
            }}
            aria-label="发送"
            title="发送"
            type="button"
          >
            <Send size={16} />
          </button>
        </div>
        <div
          style={{
            fontSize: "11px",
            color: COLORS.textTertiary,
            textAlign: "center",
            marginTop: "8px",
          }}
        >
          内容由 AI 生成，无法确保真实准确，仅供参考。
        </div>
      </div>
    </div>
  );
}

export default ChatWidget;

import { Database, ExternalLink, Gauge, ImagePlus, KeyRound, Layers3, ListChecks, Shield, UploadCloud } from "lucide-react";

const gatewayObservabilityUrl = String(import.meta.env.VITE_GATEWAY_OBSERVABILITY_URL || "").trim();

export const navItems = [
  { id: "content", label: "市场需求洞察", icon: Database, permission: "content" },
  { id: "imageGen", label: "爆文洗稿流", icon: ImagePlus, permission: "content" },
  { id: "fixedContent", label: "固定内容流", icon: Layers3, permission: "content" },
  { id: "draftReview", label: "待审核草稿", icon: ListChecks, permission: "content" },
  { id: "dataImport", label: "原始数据导入", icon: UploadCloud, permission: "content" },
  {
    id: "ops",
    label: "统一运行监控",
    icon: Gauge,
    trailingIcon: ExternalLink,
    permission: "ops",
    externalHref: gatewayObservabilityUrl,
  },
  { id: "models", label: "模型配置", icon: KeyRound, permission: "models" },
  { id: "admin", label: "管理员配置", icon: Shield, permission: "admin" },
];

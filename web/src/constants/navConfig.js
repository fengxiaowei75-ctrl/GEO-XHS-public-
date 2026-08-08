import { Database, Gauge, ImagePlus, KeyRound, Layers3, ListChecks, Shield } from "lucide-react";

export const navItems = [
  { id: "content", label: "市场需求洞察", icon: Database, permission: "content" },
  { id: "imageGen", label: "爆文洗稿流", icon: ImagePlus, permission: "content" },
  { id: "fixedContent", label: "固定内容流", icon: Layers3, permission: "content" },
  { id: "draftReview", label: "待审核草稿", icon: ListChecks, permission: "content" },
  { id: "ops", label: "运行监控", icon: Gauge, permission: "ops" },
  { id: "models", label: "模型配置", icon: KeyRound, permission: "models" },
  { id: "admin", label: "管理员配置", icon: Shield, permission: "admin" },
];

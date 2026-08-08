export const providerLabels = {
  endata_xhs_note_detail: "艺恩详情 API 调用（按 note_id 抓标题/正文/互动）",
  volcengine_ark_vision: "豆包图片解析（首图/子图视觉信息）",
  volcengine_ark_chat: "豆包内容资产总结（痛点/人群/漏斗标签）",
  volcengine_ark_embedding: "豆包 Embedding（内容资产转向量）",
  volcengine_ark_image_generation: "豆包图像生成/图生图（Seedream）",
  duomi_image_generation: "Duomi 图像生成/图生图（gpt-image-2）",
  kimi_chat: "Kimi 历史内容资产总结（旧模型记录）",
};

export const providerChartOrder = new Map(
  ["endata_xhs_note_detail", "volcengine_ark_vision", "volcengine_ark_chat", "kimi_chat", "volcengine_ark_embedding", "volcengine_ark_image_generation", "duomi_image_generation"].map(
    (code, index) => [code, index],
  ),
);

export const modelProviderTypes = ["llm_chat", "llm_vision", "embedding", "speech_to_text", "image_generation"];

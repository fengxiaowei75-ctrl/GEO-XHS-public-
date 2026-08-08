import { Clock3, FileText, ImagePlus, PencilLine, Save, Sparkles, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ImageEditPanel } from "../components/workflows/ImageEditPanel";
import { ImagePreviewModal } from "../components/workflows/ImagePreviewModal";
import { ImageWorkflowField } from "../components/workflows/ImageWorkflowField";
import { SelectControl } from "../components/form/SelectControl";
import { SectionHeader } from "../components/layout/SectionHeader";
import { StatusPill } from "../components/data/StatusPill";
import { useImageGeneration } from "../hooks/useImageGeneration";
import { requestJson } from "../hooks/useRequestJson";
import { formatDateTimeSecond, formatDuration, formatNumber, textPreview } from "../utils/formatters";
import {
  appendEditedImages,
  buildImageEditPrompt,
  emptyImageWorkflowForm,
  generatedImagesForSave,
  hasWorkflowPrompt,
  imagePromptAt,
  imagePromptSummary,
  imageResultGroupId,
  imageSlotItems,
  imageTaskPollDelay,
  imageTaskStatusLabel,
  imageVersionBadge,
  imageVersionDisplayItems,
  imageVersionLabel,
  imageWorkflowFormFromNote,
  imageWorkflowHistoryUpdatedEvent,
  maxImageTaskPollAttempts,
  maxWorkflowImages,
  normalizeWorkflowImageCount,
  normalizeWorkflowImagePrompts,
  promptPayloadForSave,
  socialPlatformLabels,
  socialPlatformOptions,
  wait,
} from "./workflowImageHelpers";
import {
  compactImageResult,
  compactSocialDraft,
  downloadBlob,
  downloadTextFile,
  filenameFromDisposition,
  historyDocumentsForItem,
  historyFormSnapshot,
  readImageWorkflowHistory,
  sanitizeXhsDraftContent,
  upsertImageWorkflowHistoryItem,
  writeImageWorkflowHistory,
} from "./workflowHistoryHelpers";
import { sourceImagesForNote } from "./workflowFixedHelpers.jsx";
export function ImageGenView({ data }) {
  const noteRows = data?.contentInsight?.noteAnalysis || [];
  const initialHistory = useMemo(() => readImageWorkflowHistory(), []);
  const latestHistory = initialHistory[0] || null;
  const [form, setForm] = useState(() =>
    latestHistory?.form ? { ...emptyImageWorkflowForm, ...latestHistory.form, referenceImage: "", referenceImageName: latestHistory.form.referenceImageName || "" } : emptyImageWorkflowForm,
  );
  const [loadingNote, setLoadingNote] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingSocial, setGeneratingSocial] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [message, setMessage] = useState("");
  const [socialMessage, setSocialMessage] = useState("");
  const [result, setResult] = useState(() => latestHistory?.result || null);
  const [socialPlatform, setSocialPlatform] = useState(() => latestHistory?.socialPlatform || latestHistory?.socialDraft?.platform || "xhs");
  const [socialDraft, setSocialDraft] = useState(() => latestHistory?.socialDraft || null);
  const [noteDetail, setNoteDetail] = useState(() => latestHistory?.noteDetail || null);
  const [historyItems, setHistoryItems] = useState(initialHistory);
  const [promptOpen, setPromptOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [editingImage, setEditingImage] = useState(false);
  const {
    editingSlot,
    editingSourceImage,
    editInstruction,
    editImageCount,
    setEditingSlot,
    setEditInstruction,
    setEditImageCount,
    openImageEdit,
    resetImageEdit,
  } = useImageGeneration({ onOpen: () => setMessage("") });
  const noteOptions = useMemo(
    () =>
      noteRows.slice(0, 300).map((item) => ({
        note_id: item.note_id,
        label: `${item.note_id} · ${item.title || "未命名笔记"}`,
      })),
    [noteRows],
  );

  useEffect(() => {
    function handleHistorySync() {
      setHistoryItems(readImageWorkflowHistory());
    }
    window.addEventListener(imageWorkflowHistoryUpdatedEvent, handleHistorySync);
    return () => window.removeEventListener(imageWorkflowHistoryUpdatedEvent, handleHistorySync);
  }, []);

  function updateForm(patch) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function updateImagePrompt(slot, value) {
    setForm((current) => {
      const nextPrompts = Array.from({ length: maxWorkflowImages }, (_, index) => {
        const promptSlot = index + 1;
        return normalizeWorkflowImagePrompts(current.imagePrompts).find((item) => item.slot === promptSlot) || { slot: promptSlot, prompt: "" };
      });
      nextPrompts[slot - 1] = { ...nextPrompts[slot - 1], slot, prompt: value };
      return { ...current, imagePrompts: nextPrompts.filter((item) => item.prompt.trim()) };
    });
  }

  function handleSocialPlatformChange(value) {
    setSocialPlatform(value);
    setSocialDraft(null);
    setSocialMessage("");
  }

  function persistHistoryItem(nextResult, nextSocialDraft = socialDraft) {
    const compactResult = compactImageResult(nextResult);
    if (!generatedImagesForSave(compactResult).length) return;
    const taskKey = imageResultGroupId(compactResult) || compactResult.images.map((image) => image.url).join("|");
    const item = {
      id: taskKey || `history-${Date.now()}`,
      createdAt: new Date().toISOString(),
      form: historyFormSnapshot(form),
      result: compactResult,
      socialPlatform,
      socialDraft: compactSocialDraft(nextSocialDraft),
      sourceImages: sourceImagesForNote(noteDetail),
    };
    const next = upsertImageWorkflowHistoryItem(item, historyItems);
    setHistoryItems(next);
  }

  function restoreHistoryItem(item) {
    setForm({ ...emptyImageWorkflowForm, ...(item.form || {}), referenceImage: "", referenceImageName: item.form?.referenceImageName || "" });
    setResult(item.result || null);
    setSocialPlatform(item.socialPlatform || item.socialDraft?.platform || "xhs");
    setSocialDraft(item.socialDraft || null);
    setNoteDetail(item.noteDetail || null);
    resetImageEdit();
    setMessage("已恢复历史产出");
    setSocialMessage(item.socialDraft?.content ? "已恢复历史社媒草稿" : "");
  }

  function removeHistoryItem(id) {
    setHistoryItems((current) => {
      const next = current.filter((item) => item.id !== id);
      writeImageWorkflowHistory(next);
      return next;
    });
  }

  async function loadNote() {
    const noteId = form.noteId.trim();
    if (!noteId) {
      setMessage("请先输入或选择 note_id");
      return;
    }
    setLoadingNote(true);
    setMessage("");
    try {
      const payload = await requestJson("/api/image-note", {
        method: "POST",
        body: JSON.stringify({ noteId }),
      });
      setNoteDetail(payload.note || null);
      setForm((current) => imageWorkflowFormFromNote(payload.note || {}, current));
      const promptCount = Number(payload.note?.image_prompt_count || 0);
      const promptWarning = payload.note?.image_prompt_warning ? `，逐图提示词暂未读取：${payload.note.image_prompt_warning}` : "";
      setMessage(`已读取 ${payload.note?.source || "数据库"} 字段${promptCount ? `，逐图提示词 ${promptCount} 条` : ""}${promptWarning}`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoadingNote(false);
    }
  }

  async function editGeneratedImage(event) {
    event.preventDefault();
    const slot = normalizeWorkflowImageCount(editingSlot);
    const instruction = editInstruction.trim();
    const editCount = Math.min(2, normalizeWorkflowImageCount(editImageCount));
    const sourceSlot = imageSlotItems(result).find((item) => item.slot === slot);
    const sourceImage = editingSourceImage?.url ? editingSourceImage : sourceSlot?.image;
    if (!sourceImage?.url) {
      setMessage("请先生成当前图片后再改图");
      return;
    }
    if (!instruction) {
      setMessage("请填写这次要修改的点");
      return;
    }

    const startedAt = Date.now();
    const originalPrompt = imagePromptAt(form, slot) || form.imagePrompt || "";
    const editPrompts = Array.from({ length: editCount }, (_, index) => ({
      slot: index + 1,
      prompt: buildImageEditPrompt({ slot, originalPrompt, instruction, branchIndex: index + 1, branchTotal: editCount }),
    }));
    setEditingImage(true);
    setMessage(editCount > 1 ? `第${slot}张改图并派生新图任务创建中` : `第${slot}张改图任务创建中`);
    try {
      const payload = await requestJson("/api/image-generate", {
        method: "POST",
        body: JSON.stringify({
          noteId: form.noteId.trim(),
          title: form.title,
          content: form.content,
          targetPersona: form.targetPersona,
          userPain: form.userPain,
          businessLogic: form.businessLogic,
          businessKnowledge: form.businessKnowledge,
          imagePrompt: editPrompts.map((item) => item.prompt).join("\n\n"),
          imagePrompts: editPrompts,
          unifiedVisualStyle: false,
          referenceImage: sourceImage.url,
          workflowAction: "image_edit",
          editSlot: slot,
          size: form.size,
          imageCount: editCount,
        }),
      });
      let editImages = (payload.images || []).map((image) => ({ ...image, sourceEditSlot: slot }));
      let taskState = (payload.tasks?.length ? payload.tasks : [{ slot: 1, taskId: payload.taskId, images: editImages }]).map((task, index) => ({
        slot: Number(task.slot || index + 1),
        taskId: task.taskId,
        status: task.images?.length ? "succeeded" : "processing",
        images: (task.images || []).map((image) => ({ ...image, sourceEditSlot: slot })),
      }));

      if (editImages.length < editCount) {
        if (!taskState.some((task) => task.taskId)) throw new Error("改图任务创建成功，但没有返回任务 ID");
        setMessage(editCount > 1 ? `第${slot}张改图与新增图生成中` : `第${slot}张改图生成中`);
        for (let attempt = 0; attempt < maxImageTaskPollAttempts; attempt += 1) {
          await wait(imageTaskPollDelay(attempt));
          for (let index = 0; index < taskState.length; index += 1) {
            const task = taskState[index];
            if (!task?.taskId || task.images?.length) continue;
            const taskPayload = await requestJson(`/api/image-task?taskId=${encodeURIComponent(task.taskId)}`);
            taskState[index] = {
              ...task,
              status: taskPayload.status,
              images: (taskPayload.images || []).map((image) => ({ ...image, sourceEditSlot: slot })),
            };
            if (taskPayload.status === "failed") throw new Error(taskPayload.error || `第${slot}张改图失败`);
          }
          editImages = taskState.flatMap((task) => task.images || []);
          if (editImages.length >= editCount) break;
          const pendingLabels = taskState.filter((task) => !task.images?.length).map((task) => `派生${task.slot}${imageTaskStatusLabel(task.status)}`);
          setMessage(pendingLabels.join("，") || `第${slot}张改图生成中`);
        }
      }

      if (editImages.length < editCount) throw new Error("改图任务仍在处理中，请稍后重试");
      const editResult = {
        ...payload,
        tasks: taskState,
        images: editImages,
        status: "succeeded",
        latencyMs: Date.now() - startedAt,
      };
      const nextResult = appendEditedImages(result, slot, editResult, editImages.slice(0, editCount), instruction, Date.now() - startedAt);
      setResult(nextResult);
      persistHistoryItem(nextResult);
      resetImageEdit();
      setMessage(payload.logWarning ? `第${slot}张已改图，监控日志写入提示：${payload.logWarning}` : `第${slot}张已改图并写入监控日志`);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setEditingImage(false);
    }
  }

  async function generateImage(event) {
    event.preventDefault();
    if (!hasWorkflowPrompt(form)) {
      setMessage("请填写生图提示词");
      return;
    }
    const startedAt = Date.now();
    const imageCount = normalizeWorkflowImageCount(form.imageCount);
    const imagePrompts = normalizeWorkflowImagePrompts(form.imagePrompts).slice(0, imageCount);
    setGenerating(true);
    setMessage("");
    setResult(null);
    resetImageEdit();
    try {
      const payload = await requestJson("/api/image-generate", {
        method: "POST",
        body: JSON.stringify({
          noteId: form.noteId.trim(),
          title: form.title,
          content: form.content,
          targetPersona: form.targetPersona,
          userPain: form.userPain,
          businessLogic: form.businessLogic,
          businessKnowledge: form.businessKnowledge,
          imagePrompt: form.imagePrompt,
          imagePrompts,
          unifiedVisualStyle: form.unifiedVisualStyle !== false,
          referenceImage: form.referenceImage,
          size: form.size,
          imageCount,
        }),
      });
      const baseResult = { ...payload, latencyMs: Date.now() - startedAt };
      setResult(baseResult);
      if ((payload.images || []).length >= imageCount) {
        persistHistoryItem(baseResult);
        setMessage(payload.logWarning ? `已生成，监控日志写入提示：${payload.logWarning}` : "已生成并写入监控日志");
        return;
      }
      const taskState = (payload.tasks?.length ? payload.tasks : [{ slot: 1, taskId: payload.taskId, images: payload.images || [] }]).map((task, index) => ({
        slot: Number(task.slot || index + 1),
        taskId: task.taskId,
        images: task.images || [],
        status: task.images?.length ? "succeeded" : "processing",
      }));
      if (!taskState.some((task) => task.taskId)) {
        throw new Error("图像生成任务创建成功，但没有返回任务 ID");
      }
      setMessage(payload.logWarning ? `任务已创建，监控日志写入提示：${payload.logWarning}` : "任务已创建，等待生成结果");

      for (let attempt = 0; attempt < maxImageTaskPollAttempts; attempt += 1) {
        await wait(imageTaskPollDelay(attempt));
        for (let index = 0; index < taskState.length; index += 1) {
          const task = taskState[index];
          if (!task.taskId || task.images?.length) continue;
          const taskPayload = await requestJson(`/api/image-task?taskId=${encodeURIComponent(task.taskId)}`);
          taskState[index] = {
            ...task,
            status: taskPayload.status,
            images: (taskPayload.images || []).map((image) => ({ ...image, slot: task.slot })),
          };
          if (taskPayload.status === "failed") {
            throw new Error(taskPayload.error || `第${task.slot}张图生成任务失败`);
          }
        }
        const images = taskState.flatMap((task) => (task.images || []).map((image) => ({ ...image, slot: task.slot })));
        const nextResult = {
          ...baseResult,
          tasks: taskState.map((task) => ({ ...task })),
          images,
          status: images.length >= imageCount ? "succeeded" : "processing",
          model: payload.model,
          size: payload.size,
          prompt: payload.prompt,
          logWarning: payload.logWarning,
          latencyMs: Date.now() - startedAt,
        };
        setResult(nextResult);
        if (images.length >= imageCount) {
          persistHistoryItem(nextResult);
          setMessage(payload.logWarning ? `已生成，监控日志写入提示：${payload.logWarning}` : "已生成并写入监控日志");
          return;
        }
        const pendingLabels = taskState.filter((task) => !task.images?.length).map((task) => `第${task.slot}张${imageTaskStatusLabel(task.status)}`);
        setMessage(pendingLabels.join("，") || "生成中");
      }
      throw new Error("图像生成仍在处理中，请稍后重新点击生成或检查任务状态");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setGenerating(false);
    }
  }

  async function generateSocialDraft() {
    setGeneratingSocial(true);
    setSocialMessage("");
    try {
      const payload = await requestJson("/api/social-generate", {
        method: "POST",
        body: JSON.stringify({
          platform: socialPlatform,
          noteId: form.noteId.trim(),
          title: form.title,
          content: form.content,
          targetPersona: form.targetPersona,
          userPain: form.userPain,
          businessLogic: form.businessLogic,
          businessKnowledge: form.businessKnowledge,
          imagePrompt: promptPayloadForSave(form),
          images: generatedImagesForSave(result),
        }),
      });
      setSocialDraft(payload);
      if (result?.images?.length) persistHistoryItem(result, payload);
      setSocialMessage(payload.logWarning ? `已生成，监控日志写入提示：${payload.logWarning}` : "社媒内容已生成并写入监控日志");
    } catch (error) {
      setSocialMessage(error.message);
    } finally {
      setGeneratingSocial(false);
    }
  }

  async function saveDraftPackage() {
    setSavingDraft(true);
    setSocialMessage("");
    try {
      const response = await fetch("/api/draft-package", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: socialPlatform,
          producedAt: new Date().toISOString(),
          noteId: form.noteId.trim(),
          title: form.title,
          content: form.content,
          targetPersona: form.targetPersona,
          userPain: form.userPain,
          businessLogic: form.businessLogic,
          businessKnowledge: form.businessKnowledge,
          imagePrompt: promptPayloadForSave(form),
          socialContent: sanitizeXhsDraftContent(socialDraft?.content || ""),
          images: generatedImagesForSave(result),
          sourceImages: sourceImagesForNote(noteDetail),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const filename = filenameFromDisposition(response.headers.get("content-disposition"), `${socialPlatformLabels[socialPlatform]}_社媒草稿.zip`);
      downloadBlob(blob, filename);
      setSocialMessage("草稿包已生成下载");
    } catch (error) {
      setSocialMessage(error.message);
    } finally {
      setSavingDraft(false);
    }
  }

  return (
    <section className="image-workflow-layout">
      <form className="panel image-workflow-form" onSubmit={generateImage}>
        <SectionHeader icon={ImagePlus} title="爆文洗稿流" action={<StatusPill tone="neutral">gpt-image-2</StatusPill>} />

        <div className="image-note-loader">
          <label>
            <span>笔记 ID</span>
            <input
              list="image-note-options"
              value={form.noteId}
              onChange={(event) => updateForm({ noteId: event.target.value })}
              placeholder="输入 note_id 后读取"
            />
          </label>
          <datalist id="image-note-options">
            {noteOptions.map((item) => (
              <option key={item.note_id} value={item.note_id}>
                {item.label}
              </option>
            ))}
          </datalist>
          <button className="copy-button" type="button" onClick={loadNote} disabled={loadingNote}>
            {loadingNote ? "读取中" : "读取"}
          </button>
        </div>

        <ImageWorkflowField label="笔记标题" value={form.title} onChange={(value) => updateForm({ title: value })} multiline={false} />
        <ImageWorkflowField label="笔记文案" value={form.content} onChange={(value) => updateForm({ content: value })} rows={5} />
        <ImageWorkflowField label="目标人群画像" value={form.targetPersona} onChange={(value) => updateForm({ targetPersona: value })} rows={3} />
        <ImageWorkflowField label="用户痛点" value={form.userPain} onChange={(value) => updateForm({ userPain: value })} rows={4} />
        <ImageWorkflowField label="业务逻辑" value={form.businessLogic} onChange={(value) => updateForm({ businessLogic: value })} rows={4} />
        <ImageWorkflowField label="业务知识点" value={form.businessKnowledge} onChange={(value) => updateForm({ businessKnowledge: value })} rows={4} />
        <div className="image-prompt-collapse">
          <button className="image-prompt-toggle" type="button" onClick={() => setPromptOpen((current) => !current)}>
            <span>生图提示词</span>
            <strong>{promptOpen ? "收起" : "展开"}</strong>
          </button>
          {promptOpen ? (
            <div className="image-prompt-editor">
              <ImageWorkflowField
                label="整组风格/全局补充"
                value={form.imagePrompt}
                onChange={(value) => updateForm({ imagePrompt: value })}
                placeholder="整组统一风格、主配色、禁止第三方公司/账号/Logo/水印/旧日期，或其他补充"
                rows={5}
              />
              <div className="image-slot-prompt-list">
                {Array.from({ length: normalizeWorkflowImageCount(form.imageCount) }, (_, index) => {
                  const slot = index + 1;
                  return (
                    <ImageWorkflowField
                      key={slot}
                      label={`第${slot}张原图对应提示词`}
                      value={imagePromptAt(form, slot)}
                      onChange={(value) => updateImagePrompt(slot, value)}
                      placeholder="读取 note_id 后会自动填充对应原图的 image2 提示词，也可手工修改"
                      rows={5}
                    />
                  );
                })}
              </div>
            </div>
          ) : (
            <button className="image-prompt-summary" type="button" onClick={() => setPromptOpen(true)}>
              {imagePromptSummary(form)}
            </button>
          )}
        </div>

        <div className="image-generation-options">
          <SelectControl
            value={form.size}
            onChange={(value) => updateForm({ size: value })}
            label="尺寸"
            options={[
              { value: "1024x1024", label: "1024x1024" },
              { value: "1024x1536", label: "1024x1536" },
              { value: "1536x1024", label: "1536x1024" },
            ]}
          />
          <SelectControl
            value={form.imageCount}
            onChange={(value) => updateForm({ imageCount: value })}
            label="数量"
            options={[
              ...Array.from({ length: maxWorkflowImages }, (_, index) => {
                const count = String(index + 1);
                return { value: count, label: `${count}张` };
              }),
            ]}
          />
          <label className="image-style-toggle">
            <input
              checked={form.unifiedVisualStyle !== false}
              type="checkbox"
              onChange={(event) => updateForm({ unifiedVisualStyle: event.target.checked })}
            />
            <span>统一风格/配色</span>
          </label>
        </div>

        <div className="image-workflow-actions">
          <button className="primary-button" type="submit" disabled={generating}>
            {generating ? "生成中" : "确认并生图"}
          </button>
          <button className="copy-button" type="button" onClick={() => setForm(emptyImageWorkflowForm)} disabled={generating}>
            清空
          </button>
        </div>
        {message ? <div className={result?.ok ? "admin-message" : "admin-message image-workflow-message"}>{message}</div> : null}

        <div className="social-draft-panel">
          <SectionHeader icon={Sparkles} title="社媒内容" action={socialDraft?.model ? <StatusPill tone="green">{socialDraft.model}</StatusPill> : null} />
          <div className="social-draft-controls">
            <SelectControl value={socialPlatform} onChange={handleSocialPlatformChange} label="类型" options={socialPlatformOptions} />
            <button className="copy-button" type="button" onClick={generateSocialDraft} disabled={generatingSocial}>
              {generatingSocial ? "生成中" : "生成社媒内容"}
            </button>
            <button className="primary-button" type="button" onClick={saveDraftPackage} disabled={savingDraft}>
              <Save size={15} />
              {savingDraft ? "保存中" : "保存草稿包"}
            </button>
          </div>
          <textarea
            className="social-draft-textarea"
            value={socialDraft?.content || ""}
            onChange={(event) => setSocialDraft((current) => ({ ...(current || { platform: socialPlatform }), content: event.target.value }))}
            onBlur={() => {
              if (result?.images?.length && socialDraft?.content) persistHistoryItem(result, socialDraft);
            }}
            placeholder="生成后的社媒内容会出现在这里"
            rows={10}
          />
          {socialMessage ? <div className="admin-message">{socialMessage}</div> : null}
        </div>
      </form>

      <section className="panel image-workflow-output">
        <SectionHeader icon={Sparkles} title="生成结果" action={result?.model ? <StatusPill tone="green">{result.model}</StatusPill> : null} />
        <div className="image-result-stage image-result-grid">
          {imageVersionDisplayItems(result, form.imageCount, true).map((item) => {
            const active = item.active;
            const slot = item.slot;
            const image = item.image;
            return (
              <div className={`image-result-card ${active ? "active" : ""}`} key={item.key}>
                <button
                  className={`image-result-slot ${image?.url ? "has-image" : ""} ${active ? "active" : ""}`}
                  type="button"
                  onClick={() => (image?.url ? setPreviewImage(image) : null)}
                  disabled={!image?.url}
                >
                  {image?.url ? (
                    <>
                      <img src={image.url} alt={`生成结果 ${slot} ${image.version || 1}`} />
                      <span className="image-version-badge">{imageVersionBadge(image)}</span>
                    </>
                  ) : (
                    <span>
                      <ImagePlus size={24} />
                      <strong>图片 {slot}</strong>
                      <em>{generating && active ? imageTaskStatusLabel(item.status === "empty" ? "processing" : item.status) : active ? "等待生成" : "空位"}</em>
                    </span>
                  )}
                </button>
                {image?.url ? (
                  <div className="image-slot-actions">
                    <button className="copy-button" type="button" onClick={() => openImageEdit(slot, image)} disabled={editingImage || generating}>
                      <PencilLine size={14} />
                      改图
                    </button>
                    <span>{item.isLatest ? "最新版本" : "历史版本"}</span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {editingSlot ? (
          <ImageEditPanel
            title={imageVersionLabel(editingSourceImage || { slot: editingSlot })}
            instruction={editInstruction}
            onInstructionChange={setEditInstruction}
            imageCount={editImageCount}
            onImageCountChange={setEditImageCount}
            onCancel={resetImageEdit}
            onSubmit={editGeneratedImage}
            editing={editingImage}
            placeholder="只写这次要改的点；如果选择派生2张，可以写：把这张拆成问题页和方法页"
          />
        ) : null}
        {result ? (
          <>
            <div className="image-result-meta">
              <span>尺寸 {result.size}</span>
              <span>耗时 {formatDuration(result.latencyMs)}</span>
              {result.taskIds?.length ? <span>任务 {result.taskIds.join(" / ")}</span> : result.taskId ? <span>任务 {result.taskId}</span> : null}
              <span>{result.logWarning ? "监控日志待补" : "监控日志已写入"}</span>
            </div>
            <div className="image-prompt-preview">
              <strong>发送给模型的提示词</strong>
              <pre>{result.prompt}</pre>
            </div>
          </>
        ) : null}
        <div className="image-history-panel">
          <SectionHeader icon={Clock3} title="历史产出" action={<StatusPill tone="neutral">{historyItems.length}组</StatusPill>} />
          {historyItems.length ? (
            <div className="image-history-list">
              {historyItems.map((item) => (
                <article className="image-history-item" key={item.id}>
                  <div className="image-history-head">
                    <div>
                      <strong>{item.form?.title || item.form?.noteId || "未命名草稿"}</strong>
                      <span>{formatDateTimeSecond(item.createdAt)} · {socialPlatformLabels[item.socialPlatform] || item.socialDraft?.platformLabel || "社媒"}</span>
                    </div>
                    <div className="image-history-actions">
                      <button className="copy-button" type="button" onClick={() => restoreHistoryItem(item)}>
                        恢复
                      </button>
                      <button className="copy-button" type="button" onClick={() => removeHistoryItem(item.id)}>
                        删除
                      </button>
                    </div>
                  </div>
                  <div className="image-history-thumbs">
                    {generatedImagesForSave(item.result).map((image, index) => (
                      <button type="button" key={`${item.id}-${image.slot}-${image.version}-${index}`} onClick={() => setPreviewImage(image)}>
                        <img src={image.url} alt={`历史图片 ${image.slot}-${image.version}`} />
                        <span>{image.label || (image.version > 1 ? `${image.slot}-${image.version}` : image.slot)}</span>
                      </button>
                    ))}
                  </div>
                  <div className="image-history-docs">
                    {historyDocumentsForItem(item).map((doc) => (
                      <button type="button" key={`${item.id}-${doc.key}`} onClick={() => downloadTextFile(doc.filename, doc.content)}>
                        <FileText size={14} />
                        {doc.label}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="image-history-empty">暂无历史产出，生成完成后会自动保留最近记录</div>
          )}
        </div>
      </section>
      <ImagePreviewModal image={previewImage} onClose={() => setPreviewImage(null)} />
    </section>
  );
}

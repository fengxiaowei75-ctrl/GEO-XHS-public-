import { Save, Sparkles } from "lucide-react";
import { ImageWorkflowField } from "./ImageWorkflowField";
import { SectionHeader } from "../layout/SectionHeader";
import { StatusPill } from "../data/StatusPill";
import { SelectControl } from "../form/SelectControl";
import {
  emptyImageWorkflowForm,
  generatedImagesForSave,
  imagePromptAt,
  imagePromptSummary,
  imageWorkflowFormFromNote,
  maxWorkflowImages,
  normalizeWorkflowImageCount,
  promptPayloadForSave,
  socialPlatformLabels,
  socialPlatformOptions,
} from "../../views/workflowImageHelpers";
import { downloadBlob, filenameFromDisposition, sanitizeXhsDraftContent } from "../../views/workflowHistoryHelpers";
import { sourceImagesForNote } from "../../views/workflowFixedHelpers";
import { requestJson } from "../../hooks/useRequestJson";

export function ImageGenFormPanel({
  form,
  noteOptions,
  loadingNote,
  generating,
  generatingSocial,
  savingDraft,
  message,
  socialMessage,
  promptOpen,
  setPromptOpen,
  socialDraft,
  socialPlatform,
  setSocialPlatform,
  setSocialDraft,
  setSocialMessage,
  updateForm,
  updateImagePrompt,
  setForm,
  setNoteDetail,
  noteDetail,
  setLoadingNote,
  setMessage,
  result,
  persistHistoryItem,
  setGeneratingSocial,
  setSavingDraft,
  onSubmit,
}) {
  function handleSocialPlatformChange(value) {
    setSocialPlatform(value);
    setSocialDraft(null);
    setSocialMessage("");
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
    <form className="panel image-workflow-form" onSubmit={onSubmit}>
      <SectionHeader icon={Sparkles} title="爆文洗稿流" action={<StatusPill tone="neutral">gpt-image-2</StatusPill>} />

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
          placeholder="生成后的社媒内容会出现在这里"
          rows={10}
        />
        {socialMessage ? <div className="admin-message">{socialMessage}</div> : null}
      </div>
    </form>
  );
}

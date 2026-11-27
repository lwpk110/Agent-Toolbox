import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import type {
  GatewayStateSnapshot,
  SkillFileCategory,
  SkillFileEntry,
  SkillSourceType,
  WorkspaceSkillCandidate,
} from '../types/toolbox';
import { api } from '../lib/api';
import { ProtoIcon } from './ProtoIcon';
import { DataOriginTag, ProtoSeg, ProtoStatus, ProtoTip } from './ProtoPrimitives';
import { ModalDialog } from './ModalDialog';

interface SkillsViewProps {
  state: GatewayStateSnapshot;
  onMountSkill: (skillId: string, tokens?: number) => Promise<void>;
  onUnmountSkill: (skillId: string, tokens?: number) => Promise<void>;
  onSaveMarkdown: (skillId: string, markdown: string) => Promise<void>;
  onCreateSkill: (payload: {
    id: string;
    version?: string;
    summary?: string;
    skillMarkdown?: string;
    toolName?: string;
    files?: Array<{ path: string; content: string }>;
    sourceType?: SkillSourceType;
    sourcePath?: string;
  }) => Promise<string>;
  onImportWorkspaceSkill: (payload: {
    relativeDir: string;
    id?: string;
    version?: string;
    summary?: string;
  }) => Promise<string>;
  onSaveSkillFile: (skillId: string, filePath: string, content: string) => Promise<void>;
  onDeleteSkillFile: (skillId: string, filePath: string) => Promise<void>;
}

const CATEGORY_LABEL: Record<SkillFileCategory, string> = {
  entry: '入口',
  script: '脚本',
  reference: '参考',
  template: '模板',
  asset: '资源',
  readme: '说明',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

interface SkillTreeFolder {
  kind: 'dir';
  name: string;
  path: string;
  children: SkillTreeNode[];
  fileCount: number;
}

interface SkillTreeFile {
  kind: 'file';
  name: string;
  path: string;
  entry: SkillFileEntry;
}

type SkillTreeNode = SkillTreeFolder | SkillTreeFile;

function buildSkillTree(files: SkillFileEntry[]): SkillTreeNode[] {
  interface MutableDir {
    name: string;
    path: string;
    dirs: Map<string, MutableDir>;
    files: SkillTreeFile[];
  }

  const root: MutableDir = { name: '', path: '', dirs: new Map(), files: [] };

  for (const entry of files) {
    const parts = entry.path.split('/').filter(Boolean);
    let cur = root;
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      if (i === parts.length - 1) {
        cur.files.push({ kind: 'file', name: part, path: entry.path, entry });
      } else {
        const nextPath = cur.path ? `${cur.path}/${part}` : part;
        let child = cur.dirs.get(part);
        if (!child) {
          child = { name: part, path: nextPath, dirs: new Map(), files: [] };
          cur.dirs.set(part, child);
        }
        cur = child;
      }
    }
  }

  const finalize = (dir: MutableDir, isRoot: boolean): SkillTreeNode[] => {
    const folderNodes: SkillTreeFolder[] = Array.from(dir.dirs.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((sub) => {
        const children = finalize(sub, false);
        const countFiles = (nodes: SkillTreeNode[]): number =>
          nodes.reduce((sum, n) => sum + (n.kind === 'file' ? 1 : n.fileCount), 0);
        return {
          kind: 'dir',
          name: sub.name,
          path: sub.path,
          children,
          fileCount: countFiles(children),
        };
      });

    const sortedFiles = [...dir.files].sort((a, b) => {
      if (isRoot) {
        if (a.name === 'SKILL.md') return -1;
        if (b.name === 'SKILL.md') return 1;
        if (a.name.toLowerCase() === 'readme.md') return 1;
        if (b.name.toLowerCase() === 'readme.md') return -1;
      }
      return a.name.localeCompare(b.name);
    });

    if (isRoot) {
      const entryFile = sortedFiles.filter((f) => f.name === 'SKILL.md');
      const otherRootFiles = sortedFiles.filter((f) => f.name !== 'SKILL.md');
      return [...entryFile, ...folderNodes, ...otherRootFiles];
    }
    return [...folderNodes, ...sortedFiles];
  };

  return finalize(root, true);
}

function collectDirPaths(nodes: SkillTreeNode[]): string[] {
  const paths: string[] = [];
  for (const n of nodes) {
    if (n.kind === 'dir') {
      paths.push(n.path, ...collectDirPaths(n.children));
    }
  }
  return paths;
}

function formatAsciiTree(
  files: Array<{ path: string; sizeBytes: number }>,
  rootName: string
): string {
  interface Node {
    name: string;
    sizeBytes?: number;
    children: Map<string, Node>;
  }
  const root: Node = { name: rootName || 'skill-bundle', children: new Map() };
  for (const f of files) {
    const parts = f.path.split('/').filter(Boolean);
    let cur = root;
    parts.forEach((p, idx) => {
      if (!cur.children.has(p)) {
        cur.children.set(p, { name: p, children: new Map() });
      }
      const next = cur.children.get(p)!;
      if (idx === parts.length - 1) next.sizeBytes = f.sizeBytes;
      cur = next;
    });
  }
  const lines = [`${root.name}/`];
  const render = (node: Node, prefix: string) => {
    const entries = Array.from(node.children.values()).sort((a, b) => {
      const aDir = a.children.size > 0;
      const bDir = b.children.size > 0;
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    entries.forEach((child, idx) => {
      const last = idx === entries.length - 1;
      const isDir = child.children.size > 0;
      const connector = last ? '└── ' : '├── ';
      const suffix = isDir ? '/' : child.sizeBytes !== undefined ? `  (${formatBytes(child.sizeBytes)})` : '';
      lines.push(`${prefix}${connector}${child.name}${suffix}`);
      if (isDir) {
        render(child, prefix + (last ? '    ' : '│   '));
      }
    });
  };
  render(root, '');
  return lines.join('\n');
}

function parseClientFrontmatter(markdown: string): {
  name?: string;
  description?: string;
  version?: string;
} {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const lines = match[1].split(/\r?\n/);
  const unquote = (v: string) => v.trim().replace(/^["'](.*)["']$/, '$1').trim();
  let name: string | undefined;
  let description: string | undefined;
  let trigger: string | undefined;
  let version: string | undefined;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const kv = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!kv) {
      const nested = line.match(/^\s+version:\s*(.+)$/);
      if (nested && !version) version = unquote(nested[1]);
      continue;
    }
    const key = kv[1].toLowerCase();
    const rawVal = kv[2].trim();
    if ((rawVal === '>' || rawVal === '>-' || rawVal === '|' || rawVal === '|-') && key === 'description') {
      const folded: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        i += 1;
        folded.push(lines[i].trim());
      }
      description = folded.join(' ').trim();
      continue;
    }
    const val = unquote(rawVal);
    if (!val) continue;
    if (key === 'name' && !name) name = val;
    else if (key === 'description' && !description) description = val;
    else if (key === 'trigger' && !trigger) trigger = val;
    else if (key === 'version' && !version) version = val;
  }
  return { name, description: description || trigger, version };
}

export function SkillsView({
  state,
  onMountSkill,
  onUnmountSkill,
  onSaveMarkdown,
  onCreateSkill,
  onImportWorkspaceSkill,
  onSaveSkillFile,
  onDeleteSkillFile,
}: SkillsViewProps) {
  const [filter, setFilter] = useState<'all' | 'on' | 'off'>('all');
  const [selectedId, setSelectedId] = useState<string>(state.skills[0]?.id || '');
  const [layer, setLayer] = useState<'md' | 'tools' | 'files'>('md');
  const [editing, setEditing] = useState(false);
  const [draftMd, setDraftMd] = useState('');
  const [saving, setSaving] = useState(false);
  const [infoTip, setInfoTip] = useState<{ title: string; body: string } | null>(null);

  // Directory explorer state (inside "目录文件" tab)
  const [selectedFilePath, setSelectedFilePath] = useState<string>('SKILL.md');
  const [collapsedDirs, setCollapsedDirs] = useState<Record<string, boolean>>({});
  const [editingFile, setEditingFile] = useState(false);
  const [draftFileContent, setDraftFileContent] = useState('');
  const [addingFile, setAddingFile] = useState(false);
  const [newFilePath, setNewFilePath] = useState('references/guide.md');
  const [newFileContent, setNewFileContent] = useState('# 按需参考文档\n\n仅在需要时由模型按需读取（L3 资源）。\n');
  const [fileActionErr, setFileActionErr] = useState('');

  // Import Skill Bundle dialog state
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<'folder' | 'workspace' | 'manual'>('folder');
  const [importErr, setImportErr] = useState('');

  // Mode 1: Local folder upload
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadedFolderName, setUploadedFolderName] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<Array<{ path: string; content: string; sizeBytes: number }>>([]);
  const [folderSkillId, setFolderSkillId] = useState('');
  const [folderVersion, setFolderVersion] = useState('1.0.0');
  const [folderSummary, setFolderSummary] = useState('');

  // Mode 2: Workspace candidates
  const [workspaceCandidates, setWorkspaceCandidates] = useState<WorkspaceSkillCandidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [pickedWorkspaceDir, setPickedWorkspaceDir] = useState('');

  // Mode 3: Manual bundle creation
  const [newId, setNewId] = useState('');
  const [newVer, setNewVer] = useState('1.0.0');
  const [newSummary, setNewSummary] = useState('');
  const [newTool, setNewTool] = useState('');
  const [newMd, setNewMd] = useState(
    '---\nname: custom-skill\nversion: 1.0.0\ndescription: "当需要执行专项自动化流程时加载"\n---\n# 标准作业规程 (SOP)\n1. 检查上下文依赖，必要时读取 `references/checklist.md`\n2. 执行 `scripts/run.sh` 或附带工具完成变更并验证结果'
  );
  const [includeScript, setIncludeScript] = useState(true);
  const [includeRef, setIncludeRef] = useState(true);
  const [includeTemplate, setIncludeTemplate] = useState(false);
  const [includeReadme, setIncludeReadme] = useState(true);

  const mountedCount = state.skills.filter((s) => s.mounted).length;
  const list = state.skills.filter((s) =>
    filter === 'all' ? true : filter === 'on' ? s.mounted : !s.mounted
  );

  const selectedSkill = state.skills.find((s) => s.id === selectedId) || state.skills[0];
  const activeFile =
    selectedSkill?.files.find((f) => f.path === selectedFilePath) || selectedSkill?.files[0];

  const fileTree = useMemo(
    () => (selectedSkill ? buildSkillTree(selectedSkill.files) : []),
    [selectedSkill]
  );
  const allDirPaths = useMemo(() => collectDirPaths(fileTree), [fileTree]);
  const allCollapsed =
    allDirPaths.length > 0 && allDirPaths.every((dir) => Boolean(collapsedDirs[dir]));

  useEffect(() => {
    if (selectedSkill) {
      setDraftMd(selectedSkill.skillMarkdown);
      setEditing(false);
      setSelectedFilePath(selectedSkill.files[0]?.path || 'SKILL.md');
      setCollapsedDirs({});
      setEditingFile(false);
      setAddingFile(false);
      setFileActionErr('');
    }
  }, [selectedSkill?.id]);

  const toggleDir = (dirPath: string) => {
    setCollapsedDirs((prev) => ({ ...prev, [dirPath]: !prev[dirPath] }));
  };

  const toggleAllDirs = () => {
    if (allCollapsed) {
      setCollapsedDirs({});
    } else {
      const next: Record<string, boolean> = {};
      allDirPaths.forEach((p) => {
        next[p] = true;
      });
      setCollapsedDirs(next);
    }
  };

  const openNewFileInDir = (dirPath: string) => {
    const ext = dirPath.startsWith('scripts') ? 'new-script.sh' : 'note.md';
    setNewFilePath(`${dirPath}/${ext}`);
    setNewFileContent(
      dirPath.startsWith('scripts')
        ? '#!/usr/bin/env bash\nset -euo pipefail\necho "ok"\n'
        : `# ${dirPath} 文档\n\n按需读取的 L3 资源内容。\n`
    );
    setCollapsedDirs((prev) => ({ ...prev, [dirPath]: false }));
    setAddingFile(true);
    setFileActionErr('');
  };

  const renderTreeNodes = (nodes: SkillTreeNode[], depth: number) =>
    nodes.map((node) => {
      if (node.kind === 'dir') {
        const isOpen = !collapsedDirs[node.path];
        return (
          <div key={`dir:${node.path}`}>
            <div className="tree-dir-wrap">
              <button
                type="button"
                className="tree-row dir"
                aria-expanded={isOpen}
                style={{ paddingLeft: `${depth * 14 + 8}px`, paddingRight: '30px' }}
                onClick={() => toggleDir(node.path)}
              >
                <ProtoIcon name="chev" className={`tree-chev${isOpen ? ' open' : ''}`} />
                <ProtoIcon name={isOpen ? 'folderOpen' : 'folder'} className="tree-folder-ic" />
                <span className="mono od-truncate od-fill">{node.name}/</span>
                <span className="small muted mono">{node.fileCount}</span>
              </button>
              <button
                type="button"
                className="tree-dir-add"
                title={`在 ${node.path}/ 下新建文件`}
                aria-label={`在 ${node.path}/ 下新建文件`}
                onClick={() => openNewFileInDir(node.path)}
              >
                <ProtoIcon name="plus" />
              </button>
            </div>
            {isOpen && (
              <div
                className="tree-children"
                style={{ '--tree-depth': depth + 1 } as CSSProperties}
              >
                {renderTreeNodes(node.children, depth + 1)}
              </div>
            )}
          </div>
        );
      }

      const f = node.entry;
      const tierText =
        f.category === 'entry' ? 'L2' : f.injectToModel ? 'L3' : '0 tok';
      const tierClass =
        f.category === 'entry' ? 'tree-tier l2' : f.injectToModel ? 'tree-tier' : 'tree-tier human';

      return (
        <button
          key={`file:${f.path}`}
          type="button"
          className="tree-row file"
          aria-current={activeFile?.path === f.path ? 'true' : undefined}
          style={{ paddingLeft: `${depth * 14 + 24}px` }}
          onClick={() => setSelectedFilePath(f.path)}
        >
          <ProtoIcon name="file" />
          <span className="mono od-truncate od-fill" title={f.path}>
            {node.name}
          </span>
          <span className={tierClass}>{tierText}</span>
        </button>
      );
    });

  useEffect(() => {
    if (activeFile) {
      setDraftFileContent(activeFile.content);
      setEditingFile(false);
      setFileActionErr('');
    }
  }, [activeFile?.path, activeFile?.sha256]);

  const loadWorkspaceCandidates = async () => {
    setLoadingCandidates(true);
    try {
      const cands = await api.getWorkspaceSkillCandidates();
      setWorkspaceCandidates(cands);
      const firstAvailable = cands.find((c) => !c.alreadyImported) || cands[0];
      setPickedWorkspaceDir(firstAvailable?.relativeDir || '');
    } catch (err) {
      setImportErr(err instanceof Error ? err.message : '扫描工作区 skills/ 目录失败');
    } finally {
      setLoadingCandidates(false);
    }
  };

  const openImportDialog = () => {
    setImportErr('');
    setImportOpen(true);
    loadWorkspaceCandidates();
  };

  const handleFolderPicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setImportErr('');

    const ignoredSegs = new Set(['.git', 'node_modules', 'dist', 'build', '.DS_Store']);
    const collected: Array<{ path: string; content: string; sizeBytes: number }> = [];
    let rootFolder = '';
    let skippedCount = 0;

    for (const file of Array.from(fileList)) {
      const rawRel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      const parts = rawRel.replace(/\\/g, '/').split('/').filter(Boolean);
      if (parts.length === 0) continue;
      if (!rootFolder && parts.length > 1) rootFolder = parts[0];
      const relParts = parts.length > 1 ? parts.slice(1) : parts;
      if (relParts.some((seg) => seg.startsWith('.') || ignoredSegs.has(seg))) {
        skippedCount += 1;
        continue;
      }
      if (file.size > 200 * 1024) {
        skippedCount += 1;
        continue;
      }
      const text = await file.text();
      if (text.includes('\0')) {
        skippedCount += 1;
        continue;
      }
      const cleanPath = relParts.join('/');
      collected.push({
        path: cleanPath.toLowerCase() === 'skill.md' ? 'SKILL.md' : cleanPath,
        content: text,
        sizeBytes: file.size,
      });
    }

    const entry = collected.find((f) => f.path === 'SKILL.md');
    if (!entry) {
      setUploadedFiles([]);
      setImportErr('所选目录缺少必需的入口文件 SKILL.md，请选择标准 Agent Skill 目录。');
      return;
    }

    const fm = parseClientFrontmatter(entry.content);
    const derivedId = (fm.name || rootFolder || 'imported-skill')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    setUploadedFolderName(rootFolder || derivedId);
    setUploadedFiles(collected);
    setFolderSkillId(derivedId);
    setFolderVersion(fm.version || '1.0.0');
    setFolderSummary(fm.description || `从本地目录 ${rootFolder || derivedId} 导入的 Skill 包`);
    if (skippedCount > 0) {
      setImportErr(`已自动跳过 ${skippedCount} 个隐藏、二进制或超大文件。`);
    }
  };

  const handleSaveMd = async () => {
    if (!selectedSkill || !draftMd.trim()) return;
    setSaving(true);
    try {
      await onSaveMarkdown(selectedSkill.id, draftMd);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveActiveFile = async () => {
    if (!selectedSkill || !activeFile) return;
    setFileActionErr('');
    setSaving(true);
    try {
      await onSaveSkillFile(selectedSkill.id, activeFile.path, draftFileContent);
      setEditingFile(false);
    } catch (err) {
      setFileActionErr(err instanceof Error ? err.message : '保存文件失败');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateNewFile = async () => {
    if (!selectedSkill) return;
    const cleanPath = newFilePath.trim();
    if (!cleanPath) {
      setFileActionErr('请填写相对文件路径（如 scripts/check.sh 或 references/rules.md）。');
      return;
    }
    setFileActionErr('');
    setSaving(true);
    try {
      await onSaveSkillFile(selectedSkill.id, cleanPath, newFileContent);
      setSelectedFilePath(cleanPath.toLowerCase() === 'skill.md' ? 'SKILL.md' : cleanPath);
      setAddingFile(false);
    } catch (err) {
      setFileActionErr(err instanceof Error ? err.message : '创建文件失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteActiveFile = async () => {
    if (!selectedSkill || !activeFile || activeFile.path === 'SKILL.md') return;
    setFileActionErr('');
    setSaving(true);
    try {
      await onDeleteSkillFile(selectedSkill.id, activeFile.path);
      setSelectedFilePath('SKILL.md');
    } catch (err) {
      setFileActionErr(err instanceof Error ? err.message : '删除文件失败');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmImport = async () => {
    setImportErr('');
    setSaving(true);
    try {
      if (importMode === 'folder') {
        if (uploadedFiles.length === 0) {
          setImportErr('请先选择一个包含 SKILL.md 的本地 Skill 目录。');
          return;
        }
        if (!folderSkillId.trim()) {
          setImportErr('请填写 Skill 标识名称。');
          return;
        }
        const createdId = await onCreateSkill({
          id: folderSkillId.trim().toLowerCase(),
          version: folderVersion.trim() || '1.0.0',
          summary: folderSummary.trim(),
          files: uploadedFiles.map((f) => ({ path: f.path, content: f.content })),
          sourceType: 'folder-upload',
          sourcePath: uploadedFolderName ? `${uploadedFolderName}/` : undefined,
        });
        setSelectedId(createdId);
        setLayer('files');
        setImportOpen(false);
        setUploadedFiles([]);
        setUploadedFolderName('');
      } else if (importMode === 'workspace') {
        if (!pickedWorkspaceDir) {
          setImportErr('请选择一个工作区 Skill 目录。');
          return;
        }
        const cand = workspaceCandidates.find((c) => c.relativeDir === pickedWorkspaceDir);
        if (cand?.alreadyImported) {
          setImportErr(`Skill「${cand.id}」已在列表中，无需重复导入。`);
          return;
        }
        const createdId = await onImportWorkspaceSkill({
          relativeDir: pickedWorkspaceDir,
        });
        setSelectedId(createdId);
        setLayer('files');
        setImportOpen(false);
      } else {
        if (!newId.trim() || !newSummary.trim() || !newMd.trim()) {
          setImportErr('请完整填写 Skill 名称、用途简介与 SKILL.md 内容。');
          return;
        }
        const targetId = newId.trim().toLowerCase();
        const bundleFiles: Array<{ path: string; content: string }> = [
          { path: 'SKILL.md', content: newMd },
        ];
        if (includeScript) {
          bundleFiles.push({
            path: 'scripts/run.sh',
            content: `#!/usr/bin/env bash\nset -euo pipefail\necho "[${targetId}] Running skill check..."\n`,
          });
        }
        if (includeRef) {
          bundleFiles.push({
            path: 'references/checklist.md',
            content: `# ${targetId} 参考清单 (L3 按需加载)\n\n- 执行前先核对输入边界条件。\n- 变更后运行 scripts/run.sh 验证结果。\n`,
          });
        }
        if (includeTemplate) {
          bundleFiles.push({
            path: 'templates/report.md',
            content: `# ${targetId} 输出模板\n\n- 摘要：{{summary}}\n- 结论：{{result}}\n`,
          });
        }
        if (includeReadme) {
          bundleFiles.push({
            path: 'README.md',
            content: `# ${targetId}\n\n人类维护说明（不注入模型上下文，占用 0 Token）。\n`,
          });
        }
        const createdId = await onCreateSkill({
          id: targetId,
          version: newVer || '1.0.0',
          summary: newSummary,
          skillMarkdown: newMd,
          toolName: newTool || undefined,
          files: bundleFiles,
          sourceType: 'manual',
        });
        setSelectedId(createdId);
        setLayer('files');
        setImportOpen(false);
        setNewId('');
        setNewSummary('');
        setNewTool('');
      }
    } catch (err) {
      setImportErr(err instanceof Error ? err.message : '导入失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="page-h">
        <div className="od-fill">
          <h1 tabIndex={-1} id="pageTitle">
            Skill 中心
          </h1>
          <p className="lead">
            每个 Skill 是一个标准目录包（含 SKILL.md、scripts、references、templates 与 README）。挂载时仅加载 L2 说明与工具，L3 目录资源按需读取。
          </p>
        </div>
        <div className="acts">
          <button type="button" className="btn" onClick={openImportDialog}>
            <ProtoIcon name="plus" />
            <span>导入 Skill 目录</span>
          </button>
        </div>
      </div>

      <div className="grid-side">
        {/* Left Skill list */}
        <section className="box" id="s-list">
          <div className="box-h">
            <h2>已安装的 Skill</h2>
            <span className="hint">共 {state.skills.length} 个</span>
          </div>
          <div className="filter">
            <ProtoSeg
              label="筛选 Skill"
              items={
                [
                  ['all', '全部'],
                  ['on', `使用中 ${mountedCount}`],
                  ['off', `待命 ${state.skills.length - mountedCount}`],
                ] as const
              }
              value={filter}
              onChange={setFilter}
            />
          </div>
          {list.length === 0 ? (
            <div className="empty">
              <ProtoIcon name="inbox" />
              <b>这个分类下没有 Skill</b>
              <span>切换到「全部」查看所有 Skill。</span>
            </div>
          ) : (
            list.map((s) => (
              <button
                key={s.id}
                type="button"
                className="skill-item"
                aria-current={selectedSkill?.id === s.id ? 'true' : undefined}
                onClick={() => {
                  setSelectedId(s.id);
                  setLayer('md');
                }}
              >
                <div className="od-row" style={{ justifyContent: 'space-between' }}>
                  <span className="od-row"><span className="nm">{s.id}</span><DataOriginTag origin={s.origin} /></span>
                  <span className="small muted mono">{s.files.length} 文件</span>
                </div>
                <span className="ds">{s.summary}</span>
                {s.mounted ? (
                  <ProtoStatus
                    kind="ok"
                    text={`使用中 · 占 ${s.estimatedTokens.toLocaleString('en-US')} Token`}
                  />
                ) : (
                  <ProtoStatus kind="off" text="待命 · 不占 Token" />
                )}
              </button>
            ))
          )}
        </section>

        {/* Right Skill Detail */}
        {selectedSkill && (
          <section className="box" id="s-detail">
            <div className="box-h">
              <h2 className="mono">{selectedSkill.id}</h2>
              <span className="hint">v{selectedSkill.version}</span>
              {selectedSkill.sourcePath && (
                <span className="hint mono" style={{ marginLeft: 'auto' }}>
                  {selectedSkill.sourcePath}
                </span>
              )}
            </div>

            <div className="box-b od-stack" style={{ '--od-gap': '16px' } as CSSProperties}>
              <div
                className="od-row"
                style={{ '--od-gap': '16px', flexWrap: 'wrap' } as CSSProperties}
              >
                <div className="od-fill">
                  <p style={{ fontSize: '16px' }}>{selectedSkill.summary}</p>
                  <div className="small muted" style={{ marginTop: '4px' }}>
                    {selectedSkill.mounted
                      ? `由 ${selectedSkill.mountedBy || 'Claude Code'} 挂载 · 已调用 ${selectedSkill.callCount} 次 · 成功率 ${selectedSkill.successRate}`
                      : '目前没有任何 Agent 在使用它（仅暴露约 ' +
                        selectedSkill.tokenBreakdown.metadataTokens +
                        ' Token 路由元数据）'}
                  </div>
                </div>
                {selectedSkill.mounted ? (
                  <ProtoStatus kind="ok" text="使用中" />
                ) : (
                  <ProtoStatus kind="off" text="待命" />
                )}
              </div>

              <div className="od-grid" style={{ '--od-cols': 3 } as CSSProperties}>
                <div className="stat" style={{ cursor: 'default' }}>
                  <span className="lbl">挂载后占用 (L2)</span>
                  <span className="num">
                    {selectedSkill.estimatedTokens.toLocaleString('en-US')}
                  </span>
                  <span className="sub">
                    正文 {selectedSkill.tokenBreakdown.entryTokens} + 工具{' '}
                    {selectedSkill.tokenBreakdown.toolsTokens} · {selectedSkill.tokenBreakdown.onDemandFiles} 个 L3 按需
                  </span>
                </div>
                <div className="stat" style={{ cursor: 'default' }}>
                  <span className="lbl">目录包结构</span>
                  <span className="num">{selectedSkill.files.length} 个文件</span>
                  <span className="sub">
                    含 {selectedSkill.attachedTools.length} 个附带工具 · {selectedSkill.tokenBreakdown.humanOnlyFiles} 份仅人类读
                  </span>
                </div>
                <div className="stat" style={{ cursor: 'default' }}>
                  <span className="lbl">整包完整性</span>
                  <span className="num" style={{ fontSize: '20px' }}>
                    <ProtoStatus kind="ok" text="已校验" />
                  </span>
                  <span className="sub mono">sha256:{selectedSkill.fingerprint}</span>
                </div>
              </div>

              <div className="od-stack" style={{ '--od-gap': '8px' } as CSSProperties}>
                <div className="od-row" style={{ flexWrap: 'wrap' }}>
                  <ProtoSeg
                    label="查看内容"
                    items={
                      [
                        ['md', 'SKILL.md'],
                        ['tools', `附带工具 ${selectedSkill.attachedTools.length}`],
                        ['files', `目录文件 ${selectedSkill.files.length}`],
                      ] as const
                    }
                    value={layer}
                    onChange={setLayer}
                  />
                  <ProtoTip
                    label="三级渐进式目录 Skill"
                    text="标准 Skill 是一个目录包：L1 仅暴露名称与简介用于路由；L2 在挂载时加载 SKILL.md 与附带工具；L3 的 scripts/references/templates 由 Agent 通过 toolbox__read_skill_file 按需读取；README.md 仅给人看，占 0 Token。整包 SHA-256 覆盖目录内全部文件。"
                    onOpen={setInfoTip}
                  />
                  <span className="od-fill" />
                  {layer === 'md' && (
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => {
                        if (editing) {
                          setDraftMd(selectedSkill.skillMarkdown);
                          setEditing(false);
                        } else {
                          setEditing(true);
                        }
                      }}
                    >
                      <span>{editing ? '取消编辑' : '编辑'}</span>
                    </button>
                  )}
                  {layer === 'files' && (
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => {
                        setFileActionErr('');
                        setAddingFile((prev) => !prev);
                      }}
                    >
                      <ProtoIcon name="plus" />
                      <span>{addingFile ? '取消新建' : '新建文件'}</span>
                    </button>
                  )}
                </div>

                {layer === 'md' ? (
                  editing ? (
                    <div className="od-stack" style={{ '--od-gap': '8px' } as CSSProperties}>
                      <textarea
                        rows={9}
                        className="input mono"
                        value={draftMd}
                        onChange={(e) => setDraftMd(e.target.value)}
                      />
                      <div className="od-row" style={{ justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn pri sm"
                          disabled={saving}
                          onClick={handleSaveMd}
                        >
                          <span>{saving ? '保存中…' : '保存 SKILL.md'}</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="muted small">
                        入口文档 SKILL.md（L2）：挂载时注入给 AI，指导何时调用附带工具或按需读取目录中的脚本与参考文档。
                      </p>
                      <pre className="code">{selectedSkill.skillMarkdown}</pre>
                    </>
                  )
                ) : layer === 'tools' ? (
                  <>
                    <p className="muted small">
                      Skill 附带的可执行工具声明，挂载后通过 MCP 暴露给 Agent 调用。
                    </p>
                    <table
                      className="tbl"
                      style={{ border: '1px solid var(--line)', borderRadius: '6px' }}
                    >
                      <thead>
                        <tr>
                          <th>工具名</th>
                          <th>说明</th>
                          <th className="num">Token</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedSkill.attachedTools.map((t) => (
                          <tr key={t.name}>
                            <td className="mono small">{t.name}</td>
                            <td className="small muted">{t.description}</td>
                            <td className="num mono">{t.estimatedTokens}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ) : (
                  <div className="od-stack" style={{ '--od-gap': '10px' } as CSSProperties}>
                    <p className="muted small">
                      目录内所有文件均纳入整包 SHA-256 指纹锁。Agent 可在挂载后调用{' '}
                      <span className="mono">toolbox__read_skill_file</span> 按需读取 L3 资源；README.md 仅给人阅读（0 Token）。
                    </p>

                    {addingFile && (
                      <div
                        className="box"
                        style={{ background: 'var(--subtle)', padding: '12px' }}
                      >
                        <div className="od-stack" style={{ '--od-gap': '8px' } as CSSProperties}>
                          <div className="od-row" style={{ flexWrap: 'wrap' }}>
                            <input
                              className="input mono od-fill"
                              value={newFilePath}
                              onChange={(e) => setNewFilePath(e.target.value)}
                              placeholder="如 scripts/lint.sh、references/rules.md、templates/pr.md"
                            />
                            <button
                              type="button"
                              className="btn pri sm"
                              disabled={saving}
                              onClick={handleCreateNewFile}
                            >
                              <span>{saving ? '写入中…' : '添加到目录包'}</span>
                            </button>
                          </div>
                          <textarea
                            rows={4}
                            className="input mono"
                            value={newFileContent}
                            onChange={(e) => setNewFileContent(e.target.value)}
                          />
                        </div>
                      </div>
                    )}

                    {fileActionErr && (
                      <span className="small" style={{ color: 'var(--bad)' }}>
                        {fileActionErr}
                      </span>
                    )}

                    <div className="skill-files-grid">
                      <div className="skill-file-list" role="tree" aria-label="Skill 目录树">
                        <div className="skill-tree-head">
                          <ProtoIcon name="folderOpen" />
                          <span className="mono od-truncate od-fill" style={{ fontWeight: 600 }}>
                            {selectedSkill.id}/
                          </span>
                          {allDirPaths.length > 0 && (
                            <button
                              type="button"
                              className="btn link sm"
                              style={{ height: '20px', padding: '0 4px', fontSize: '11px' }}
                              onClick={toggleAllDirs}
                            >
                              {allCollapsed ? '展开' : '折叠'}
                            </button>
                          )}
                        </div>
                        <div className="skill-tree-body">{renderTreeNodes(fileTree, 0)}</div>
                      </div>

                      {activeFile && (
                        <div className="skill-file-pane">
                          <div className="od-row" style={{ flexWrap: 'wrap' }}>
                            <div className="od-fill">
                              <div className="od-row" style={{ '--od-gap': '6px', flexWrap: 'wrap' } as CSSProperties}>
                                <span className="mono" style={{ fontWeight: 600, fontSize: '13px' }}>
                                  {activeFile.path}
                                </span>
                                <span className="tag">{CATEGORY_LABEL[activeFile.category]}</span>
                              </div>
                              <div className="small muted mono">
                                {formatBytes(activeFile.sizeBytes)} · sha256:{activeFile.sha256} ·{' '}
                                {activeFile.category === 'entry'
                                  ? 'L2 入口文档'
                                  : activeFile.injectToModel
                                  ? 'L3 按需读取（不预占上下文）'
                                  : '仅人类阅读（0 Token）'}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="btn sm"
                              onClick={() => {
                                if (editingFile) {
                                  setDraftFileContent(activeFile.content);
                                  setEditingFile(false);
                                } else {
                                  setEditingFile(true);
                                }
                              }}
                            >
                              <span>{editingFile ? '取消' : '编辑文件'}</span>
                            </button>
                            {activeFile.path !== 'SKILL.md' && (
                              <button
                                type="button"
                                className="btn danger sm"
                                disabled={saving}
                                onClick={handleDeleteActiveFile}
                              >
                                <span>删除</span>
                              </button>
                            )}
                          </div>

                          {editingFile ? (
                            <div className="od-stack" style={{ '--od-gap': '8px' } as CSSProperties}>
                              <textarea
                                rows={10}
                                className="input mono"
                                value={draftFileContent}
                                onChange={(e) => setDraftFileContent(e.target.value)}
                              />
                              <div className="od-row" style={{ justifyContent: 'flex-end' }}>
                                <button
                                  type="button"
                                  className="btn pri sm"
                                  disabled={saving}
                                  onClick={handleSaveActiveFile}
                                >
                                  <span>{saving ? '保存中…' : '保存并重算指纹'}</span>
                                </button>
                              </div>
                            </div>
                          ) : (
                            <pre className="code" style={{ maxHeight: '340px', overflow: 'auto' }}>
                              {activeFile.content}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="box-f">
              {selectedSkill.mounted ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => onUnmountSkill(selectedSkill.id, selectedSkill.estimatedTokens)}
                >
                  <span>
                    卸载（释放 {selectedSkill.estimatedTokens.toLocaleString('en-US')} Token）
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  className="btn pri"
                  onClick={() => onMountSkill(selectedSkill.id, selectedSkill.estimatedTokens)}
                >
                  <span>挂载到唯一 MCP 入口</span>
                </button>
              )}
            </div>
          </section>
        )}
      </div>

      {/* Real Production Modal: Import Skill Directory Bundle */}
      <ModalDialog
        open={importOpen}
        wide
        title="导入 Skill 目录包"
        confirmLabel={
          importMode === 'workspace' ? '导入所选工作区目录' : '导入并计算整包指纹'
        }
        busy={saving}
        onClose={() => setImportOpen(false)}
        onConfirm={handleConfirmImport}
      >
        <div className="od-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <ProtoSeg
            label="导入方式"
            items={
              [
                ['folder', '上传本地目录'],
                ['workspace', '工作区目录'],
                ['manual', '手动新建'],
              ] as const
            }
            value={importMode}
            onChange={(m) => {
              setImportMode(m);
              setImportErr('');
            }}
          />
          <span className="small muted">支持 SKILL.md + scripts / references / templates / README</span>
        </div>

        {importMode === 'folder' ? (
          <div className="od-stack" style={{ '--od-gap': '12px' } as CSSProperties}>
            <div className="drop-zone">
              <div className="od-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <div>
                  <b style={{ display: 'block', fontSize: '13px' }}>选择本地 Skill 文件夹</b>
                  <span className="small muted">
                    自动读取目录内全部文本文件，并从 SKILL.md 提取元数据（自动忽略 .git 与二进制文件）
                  </span>
                </div>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => folderInputRef.current?.click()}
                >
                  <span>选择文件夹…</span>
                </button>
              </div>
              <input
                ref={folderInputRef}
                type="file"
                multiple
                style={{ display: 'none' }}
                {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                onChange={handleFolderPicked}
              />
            </div>

            {uploadedFiles.length > 0 && (
              <>
                <div className="grid-2" style={{ gap: '12px' }}>
                  <div className="field">
                    <label htmlFor="folderSkId">Skill 标识</label>
                    <input
                      id="folderSkId"
                      className="input mono"
                      value={folderSkillId}
                      onChange={(e) => setFolderSkillId(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="folderSkVer">版本</label>
                    <input
                      id="folderSkVer"
                      className="input mono"
                      value={folderVersion}
                      onChange={(e) => setFolderVersion(e.target.value)}
                    />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="folderSkSum">用途简介</label>
                  <input
                    id="folderSkSum"
                    className="input"
                    value={folderSummary}
                    onChange={(e) => setFolderSummary(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>已识别目录树（共 {uploadedFiles.length} 个文件）</label>
                  <pre className="code" style={{ maxHeight: '150px', overflow: 'auto' }}>
                    {formatAsciiTree(uploadedFiles, uploadedFolderName || folderSkillId)}
                  </pre>
                </div>
              </>
            )}
          </div>
        ) : importMode === 'workspace' ? (
          <div className="od-stack" style={{ '--od-gap': '10px' } as CSSProperties}>
            <p className="small muted">
              扫描当前工作区 <span className="mono">skills/</span> 目录下包含{' '}
              <span className="mono">SKILL.md</span> 的标准 Skill 包，一键导入整套目录文件。
            </p>
            {loadingCandidates ? (
              <div className="small muted">正在扫描工作区目录…</div>
            ) : workspaceCandidates.length === 0 ? (
              <div className="empty" style={{ padding: '20px' }}>
                <b>工作区 skills/ 下暂无可导入目录</b>
                <span>请将包含 SKILL.md 的目录放入项目根目录的 skills/ 文件夹。</span>
              </div>
            ) : (
              <div className="od-stack" style={{ '--od-gap': '8px' } as CSSProperties}>
                {workspaceCandidates.map((cand) => (
                  <button
                    key={cand.relativeDir}
                    type="button"
                    className="cand-item"
                    aria-current={pickedWorkspaceDir === cand.relativeDir ? 'true' : undefined}
                    onClick={() => setPickedWorkspaceDir(cand.relativeDir)}
                  >
                    <div className="od-row" style={{ justifyContent: 'space-between' }}>
                      <span className="mono" style={{ fontWeight: 600 }}>
                        skills/{cand.relativeDir}
                      </span>
                      <span className="small muted">
                        {cand.alreadyImported ? '已导入' : `${cand.fileCount} 个文件 · v${cand.version}`}
                      </span>
                    </div>
                    <span className="small muted">{cand.summary}</span>
                    <div className="od-cluster" style={{ '--od-gap': '6px' } as CSSProperties}>
                      {cand.files.map((f) => (
                        <span key={f.path} className="tag mono">
                          {f.path}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="od-stack" style={{ '--od-gap': '10px' } as CSSProperties}>
            <div className="grid-2" style={{ gap: '12px' }}>
              <div className="field">
                <label htmlFor="skId">
                  Skill 标识 <span style={{ color: 'var(--bad)' }}>*</span>
                </label>
                <input
                  id="skId"
                  data-autofocus="true"
                  className="input mono"
                  value={newId}
                  onChange={(e) => setNewId(e.target.value)}
                  placeholder="如 k8s-pod-debugger"
                />
              </div>
              <div className="field">
                <label htmlFor="skVer">版本</label>
                <input
                  id="skVer"
                  className="input mono"
                  value={newVer}
                  onChange={(e) => setNewVer(e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="skSummary">
                用途简介 <span style={{ color: 'var(--bad)' }}>*</span>
              </label>
              <input
                id="skSummary"
                className="input"
                value={newSummary}
                onChange={(e) => setNewSummary(e.target.value)}
                placeholder="排查 Kubernetes Pod 崩溃与镜像拉取异常"
              />
            </div>
            <div className="field">
              <label htmlFor="skTool">附带工具名（可选）</label>
              <input
                id="skTool"
                className="input mono"
                value={newTool}
                onChange={(e) => setNewTool(e.target.value)}
                placeholder="如 skill_k8s__inspect_pod"
              />
            </div>
            <div className="field">
              <label>初始目录骨架（可选）</label>
              <div className="od-cluster" style={{ '--od-gap': '12px' } as CSSProperties}>
                <label className="small" style={{ fontWeight: 400, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <input
                    type="checkbox"
                    checked={includeScript}
                    onChange={(e) => setIncludeScript(e.target.checked)}
                  />
                  <span className="mono">scripts/run.sh</span>
                </label>
                <label className="small" style={{ fontWeight: 400, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <input
                    type="checkbox"
                    checked={includeRef}
                    onChange={(e) => setIncludeRef(e.target.checked)}
                  />
                  <span className="mono">references/checklist.md</span>
                </label>
                <label className="small" style={{ fontWeight: 400, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <input
                    type="checkbox"
                    checked={includeTemplate}
                    onChange={(e) => setIncludeTemplate(e.target.checked)}
                  />
                  <span className="mono">templates/report.md</span>
                </label>
                <label className="small" style={{ fontWeight: 400, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <input
                    type="checkbox"
                    checked={includeReadme}
                    onChange={(e) => setIncludeReadme(e.target.checked)}
                  />
                  <span className="mono">README.md</span>
                </label>
              </div>
            </div>
            <div className="field">
              <label htmlFor="skMd">
                SKILL.md 入口内容 <span style={{ color: 'var(--bad)' }}>*</span>
              </label>
              <textarea
                id="skMd"
                rows={5}
                className="input mono"
                value={newMd}
                onChange={(e) => setNewMd(e.target.value)}
              />
            </div>
          </div>
        )}

        {importErr && <span className="err">{importErr}</span>}
      </ModalDialog>

      <ModalDialog
        open={Boolean(infoTip)}
        title={infoTip?.title || ''}
        confirmLabel="知道了"
        hideCancel
        onClose={() => setInfoTip(null)}
        onConfirm={() => setInfoTip(null)}
      >
        <p>{infoTip?.body}</p>
      </ModalDialog>
    </>
  );
}

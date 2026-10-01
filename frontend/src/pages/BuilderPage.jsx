import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Panel,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  ReactFlowProvider,
  useReactFlow,
} from "reactflow";
import "reactflow/dist/style.css";
import { LayoutTemplate, History, KeyRound, Menu, X, Trash2 } from "lucide-react";
import { api } from "../api.js";
import NodeConfigPanel from "../components/NodeConfigPanel.jsx";
import NodePalette from "../components/NodePalette.jsx";
import CustomNode from "../components/CustomNode.jsx";
import ExecutionHistoryPanel from "../components/ExecutionHistoryPanel.jsx";
import ExecutionTrace from "../components/ExecutionTrace.jsx";
import TemplateGallery from "../components/TemplateGallery.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";
import AccountMenu from "../components/AccountMenu.jsx";

const nodeTypes = { default: CustomNode };
let idCounter = 1;
const newId = () => `node_${Date.now()}_${idCounter++}`;
const SKIP_TEMPLATE_KEY = "ff_skip_template_prompt";

function BuilderCanvas() {
  const { id } = useParams();
  const wrapperRef = useRef(null);
  const { screenToFlowPosition } = useReactFlow();
  const isMobile = useIsMobile();

  const [name, setName] = useState("Untitled workflow");
  const [active, setActive] = useState(false);
  const [webhookPath, setWebhookPath] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [runLog, setRunLog] = useState(null);
  const [status, setStatus] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showPalette, setShowPalette] = useState(false); // mobile drawer, closed by default
  const [loaded, setLoaded] = useState(false);
  const [errorWorkflowId, setErrorWorkflowId] = useState("");
  const [otherWorkflows, setOtherWorkflows] = useState([]);
  const [plan, setPlan] = useState("free");
  const [versions, setVersions] = useState([]);
  const [me, setMe] = useState(null);
  const [billing, setBilling] = useState(null);
  const [accessRole, setAccessRole] = useState("editor");

  useEffect(() => {
    api.listWorkflows().then(setOtherWorkflows).catch(() => {});
    api.me().then((account) => { setMe(account); setPlan(account.plan || "free"); }).catch(() => {});
    api.getBillingStatus().then(setBilling).catch(() => {});
    api.getWorkflowVersions(id).then(setVersions).catch(() => {});
  }, [id]);

  useEffect(() => {
    api.getWorkflow(id).then((wf) => {
      setName(wf.name);
      setActive(!!wf.active);
      setWebhookPath(wf.webhook_path);
      setErrorWorkflowId(wf.error_workflow_id || "");
      setAccessRole(wf.accessRole || "editor");
      const loadedNodes = (wf.definition.nodes || []).map((n) => ({
        id: n.id,
        type: "default",
        position: n.position || { x: 100, y: 100 },
        data: { nodeType: n.type || n.data?.nodeType, config: n.data?.config || {} },
      }));
      setNodes(loadedNodes);
      setEdges(wf.definition.edges || []);
      setLoaded(true);

      const skipId = sessionStorage.getItem(SKIP_TEMPLATE_KEY);
      if (skipId === id) {
        sessionStorage.removeItem(SKIP_TEMPLATE_KEY);
      } else if ((wf.definition.nodes || []).length === 0) {
        setShowTemplates(true);
      }
    });
  }, [id]);

  const readOnly = accessRole === "viewer";
  const onNodesChange = useCallback((changes) => { if (!readOnly) setNodes((nds) => applyNodeChanges(changes, nds)); }, [readOnly]);
  const onEdgesChange = useCallback((changes) => { if (!readOnly) setEdges((eds) => applyEdgeChanges(changes, eds)); }, [readOnly]);
  const onConnect = useCallback((connection) => { if (!readOnly) setEdges((eds) => addEdge({ ...connection, id: `e_${Date.now()}` }, eds)); }, [readOnly]);

  function addNodeAt(type, position) {
    if (readOnly) return;
    setNodes((nds) => [...nds, { id: newId(), type: "default", position, data: { nodeType: type, config: {} } }]);
  }

  function deleteSelectedNode() {
    if (readOnly || !selectedNode) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNode));
    setEdges((eds) => eds.filter((e) => e.source !== selectedNode && e.target !== selectedNode));
    setSelectedNode(null);
  }

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      const nodeType = event.dataTransfer.getData("application/flowforge-node");
      if (!nodeType) return;
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addNodeAt(nodeType, position);
    },
    [screenToFlowPosition]
  );
  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  function toEngineDefinition() {
    return {
      nodes: nodes.map((n) => ({ id: n.id, type: n.data.nodeType, position: n.position, data: { config: n.data.config } })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle })),
    };
  }

  async function save(showStatus = true) {
    if (readOnly) return false;
    if (showStatus) setStatus("Saving...");
    try {
      await api.updateWorkflow(id, { name, definition: toEngineDefinition(), active, errorWorkflowId: errorWorkflowId || null });
      api.getWorkflowVersions(id).then(setVersions).catch(() => {});
      if (showStatus) {
        setStatus("Saved");
        setTimeout(() => setStatus(""), 1500);
      }
      return true;
    } catch (error) {
      setStatus(`Save failed: ${error.message}`);
      return false;
    }
  }

  async function restoreVersion(version) {
    if (readOnly || !version || !window.confirm(`Restore version ${version}? Your current workflow will be saved as a new version.`)) return;
    try {
      const restored = await api.restoreWorkflowVersion(id, version);
      setName(restored.name);
      setNodes((restored.definition.nodes || []).map((n) => ({ id: n.id, type: "default", position: n.position || { x: 100, y: 100 }, data: { nodeType: n.type || n.data?.nodeType, config: n.data?.config || {} } })));
      setEdges(restored.definition.edges || []);
      api.getWorkflowVersions(id).then(setVersions).catch(() => {});
      setStatus("Version restored");
    } catch (e) {
      setStatus(`Restore failed: ${e.message}`);
    }
  }

  async function runNow() {
    if (readOnly) return;
    if (!(await save(false))) return;
    setStatus("Running...");
    try {
      const result = await api.runWorkflow(id, {});
      setRunLog(result.log);
      setStatus("Run complete");
    } catch (e) {
      setRunLog([{ type: "error", durationMs: 0, error: e.message, output: null }]);
      setStatus("Run failed: " + e.message);
    }
  }

  function updateNodeConfig(nodeId, config) {
    setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, config } } : n)));
  }

  function applyTemplate(definition) {
    const mapped = (definition.nodes || []).map((n) => ({
      id: n.id,
      type: "default",
      position: n.position,
      data: { nodeType: n.data.nodeType, config: n.data.config || {} },
    }));
    setNodes(mapped);
    setEdges((definition.edges || []).map((e) => ({ ...e })));
    setShowTemplates(false);
  }

  // On mobile, tapping a palette node adds it to the canvas directly (drag
  // targets are unreliable on touch), then closes the drawer so the user
  // immediately sees what they added.
  function handleMobilePaletteAdd(type) {
    addNodeAt(type, { x: 100 + nodes.length * 30, y: 100 + nodes.length * 30 });
    setShowPalette(false);
  }

  const selected = nodes.find((n) => n.id === selectedNode);
  const selectedForPanel = selected ? { id: selected.id, type: selected.data.nodeType, data: selected.data } : null;

  const renderedNodes = useMemo(
    () => nodes.map((n) => ({ ...n, data: { ...n.data, label: n.data.nodeType } })),
    [nodes]
  );

  if (!loaded) return <div style={{ padding: 40 }}>Loading...</div>;

  // ---- Desktop layout: fixed sidebar + canvas + side panels ----
  if (!isMobile) {
    return (
      <div className="builder-shell">
        <div className="builder-topbar">
          <div className="builder-context">
            <Link to="/workflows" className="builder-brand">iii3xnz</Link>
            <span>/</span>
            <span className="builder-context-name">{name}</span>
          </div>
          <div className="builder-actions">
            <Link to="/credentials"><button title="Credentials" aria-label="Credentials" className="builder-icon-action"><KeyRound size={14} /><span>Credentials</span></button></Link>
            <AccountMenu me={me} billing={billing} onAvatarChange={(url) => setMe((current) => ({ ...current, avatarUrl: url }))} />
          </div>
        </div>
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div className="builder-sidebar">
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly} style={{ width: "100%", marginBottom: 10, fontWeight: 600 }} />
          <label style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
            <input type="checkbox" checked={active} disabled={readOnly} onChange={(e) => setActive(e.target.checked)} /> Active
          </label>
          {active && webhookPath && (
            <div style={{ fontSize: 10, wordBreak: "break-all", marginBottom: 10, color: "var(--text-muted)", background: "var(--surface-2)", padding: 6, borderRadius: 4 }}>
              /webhook/{webhookPath}
            </div>
          )}
          <label style={{ fontSize: 11, display: "block", marginBottom: 4 }}>On error, run:</label>
          <select
            value={errorWorkflowId}
            onChange={(e) => setErrorWorkflowId(e.target.value)}
            style={{ width: "100%", marginBottom: 10, fontSize: 11 }}
          >
            <option value="">Nothing</option>
            {otherWorkflows.filter((w) => w.id !== id).map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            {!readOnly && <><button onClick={() => save(true)} style={{ flex: 1 }}>Save</button><button onClick={runNow} className="btn-primary" style={{ flex: 1 }}>Run</button></>}
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            <button onClick={() => setShowTemplates(true)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, fontSize: 11 }}>
              <LayoutTemplate size={12} /> Templates
            </button>
            <button onClick={() => setShowHistory(true)} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, fontSize: 11 }}>
              <History size={12} /> History
            </button>
          </div>
          {versions.length > 0 && (
            <select aria-label="Restore workflow version" defaultValue="" onChange={(e) => restoreVersion(e.target.value)} style={{ width: "100%", marginBottom: 10, fontSize: 11 }}>
              <option value="">Restore a previous version...</option>
              {versions.map((version) => <option key={version.version} value={version.version}>Version {version.version} - {new Date(version.created_at).toLocaleString()}</option>)}
            </select>
          )}
          <div style={{ fontSize: 11, color: "var(--primary)", marginBottom: 12, minHeight: 14 }}>{status}</div>

          <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "8px 0" }} />
          {!readOnly && <NodePalette plan={plan} />}
        </div>

        <div style={{ flex: 1, position: "relative" }} ref={wrapperRef} onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={renderedNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelectedNode(n.id)}
            onPaneClick={() => setSelectedNode(null)}
            fitView
          >
            <Background gap={16} color="#262a36" />
            <Panel position="bottom-left" className="builder-control-stack">
              <button
                onClick={deleteSelectedNode}
                disabled={!selectedNode}
                title={selectedNode ? "Delete selected node" : "Select a node to delete"}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 4,
                  background: selectedNode ? "var(--surface)" : "var(--surface-2)",
                  border: "1px solid var(--border)",
                  color: selectedNode ? "var(--danger)" : "var(--text-muted)",
                  cursor: selectedNode ? "pointer" : "not-allowed",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "all 0.2s",
                  opacity: selectedNode ? 1 : 0.5,
                }}
                onMouseEnter={(e) => {
                  if (selectedNode) {
                    e.currentTarget.style.background = "var(--danger)";
                    e.currentTarget.style.color = "white";
                  }
                }}
                onMouseLeave={(e) => {
                  if (selectedNode) {
                    e.currentTarget.style.background = "var(--surface)";
                    e.currentTarget.style.color = "var(--danger)";
                  }
                }}
              >
                <Trash2 size={16} />
              </button>
              <Controls position="bottom-left" />
            </Panel>
            <MiniMap pannable zoomable style={{ height: 100 }} />
          </ReactFlow>

          {nodes.length === 0 && (
            <div style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", background: "var(--surface-2)", color: "var(--primary-hover)", fontSize: 12, padding: "6px 14px", borderRadius: 20 }}>
              Drag a node from the left panel to get started
            </div>
          )}

          {runLog && (
            <div style={{ position: "absolute", bottom: 12, left: 12, width: 380, maxHeight: 320, overflowY: "auto", background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 4px 16px rgba(0,0,0,0.4)", fontSize: 11, padding: 12, borderRadius: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <strong style={{ fontSize: 12 }}>Run result</strong>
                <button onClick={() => setRunLog(null)} style={{ border: "none", background: "none", cursor: "pointer" }}>×</button>
              </div>
              <ExecutionTrace log={runLog} />
            </div>
          )}
        </div>

        {selectedForPanel && !readOnly && (
          <NodeConfigPanel node={selectedForPanel} onChange={updateNodeConfig} onClose={() => setSelectedNode(null)} />
        )}

        {showHistory && <ExecutionHistoryPanel workflowId={id} onClose={() => setShowHistory(false)} />}
        {showTemplates && <TemplateGallery onSelect={applyTemplate} onClose={() => setShowTemplates(false)} />}
        </div>
      </div>
    );
  }

  // ---- Mobile layout: top toolbar + full-canvas + drawer/sheets for palette, config, history ----
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div className="builder-mobile-topbar">
        <button onClick={() => setShowPalette(true)} aria-label="Open node palette" style={{ padding: 8 }}>
          <Menu size={18} />
        </button>
        <Link to="/workflows" className="builder-mobile-brand">iii3xnz</Link>
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly} style={{ flex: 1, fontWeight: 600, fontSize: 13 }} />
        {!readOnly && <button onClick={() => save(true)} style={{ padding: "6px 10px", fontSize: 12 }}>Save</button>}
        <button onClick={runNow} className="btn-primary" style={{ padding: "6px 10px", fontSize: 12 }}>Run</button>
        <AccountMenu me={me} billing={billing} onAvatarChange={(url) => setMe((current) => ({ ...current, avatarUrl: url }))} />
      </div>

      <div style={{ display: "flex", gap: 6, padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
        <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={active} disabled={readOnly} onChange={(e) => setActive(e.target.checked)} /> Active
        </label>
        <button onClick={() => setShowTemplates(true)} style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 3 }}>
          <LayoutTemplate size={11} /> Templates
        </button>
        <button onClick={() => setShowHistory(true)} style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 3 }}>
          <History size={11} /> History
        </button>
        {status && <span style={{ fontSize: 11, color: "var(--primary)", marginLeft: "auto" }}>{status}</span>}
      </div>

      <div style={{ flex: 1, position: "relative" }}>
        <ReactFlow
          nodes={renderedNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, n) => setSelectedNode(n.id)}
          onPaneClick={() => setSelectedNode(null)}
          fitView
        >
          <Background gap={16} color="#262a36" />
          <Panel position="bottom-left" className="builder-control-stack">
            <button
              onClick={deleteSelectedNode}
              disabled={!selectedNode}
              title={selectedNode ? "Delete selected node" : "Select a node to delete"}
              style={{
                width: 36,
                height: 36,
                borderRadius: 4,
                background: selectedNode ? "var(--surface)" : "var(--surface-2)",
                border: "1px solid var(--border)",
                color: selectedNode ? "var(--danger)" : "var(--text-muted)",
                cursor: selectedNode ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.2s",
                opacity: selectedNode ? 1 : 0.5,
              }}
              onMouseEnter={(e) => {
                if (selectedNode) {
                  e.currentTarget.style.background = "var(--danger)";
                  e.currentTarget.style.color = "white";
                }
              }}
              onMouseLeave={(e) => {
                if (selectedNode) {
                  e.currentTarget.style.background = "var(--surface)";
                  e.currentTarget.style.color = "var(--danger)";
                }
              }}
            >
              <Trash2 size={16} />
            </button>
            <Controls position="bottom-left" />
          </Panel>
        </ReactFlow>

        {nodes.length === 0 && (
          <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", background: "var(--surface-2)", color: "var(--primary-hover)", fontSize: 11, padding: "6px 12px", borderRadius: 20, whiteSpace: "nowrap" }}>
            Tap ☰ to add a node
          </div>
        )}

        {runLog && (
          <div style={{ position: "absolute", bottom: 8, left: 8, right: 8, maxHeight: "45vh", overflowY: "auto", background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 4px 16px rgba(0,0,0,0.4)", fontSize: 11, padding: 10, borderRadius: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <strong style={{ fontSize: 12 }}>Run result</strong>
              <button onClick={() => setRunLog(null)} style={{ border: "none", background: "none" }}>×</button>
            </div>
            <ExecutionTrace log={runLog} />
          </div>
        )}
      </div>

      {/* Palette drawer */}
      {showPalette && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 60 }} onClick={() => setShowPalette(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: "80%", maxWidth: 300, background: "var(--surface)", padding: 14, overflowY: "auto" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <strong>Add a node</strong>
              <button onClick={() => setShowPalette(false)}><X size={16} /></button>
            </div>
            {!readOnly && <NodePalette onSelect={handleMobilePaletteAdd} plan={plan} />}
          </div>
        </div>
      )}

      {/* Node config: full-screen sheet on mobile instead of a side panel */}
      {selectedForPanel && (
        <div style={{ position: "fixed", inset: 0, background: "var(--surface)", zIndex: 70, overflowY: "auto" }}>
          {selectedForPanel && !readOnly && <NodeConfigPanel node={selectedForPanel} onChange={updateNodeConfig} onClose={() => setSelectedNode(null)} fullScreen />}
        </div>
      )}

      {/* History: full-screen sheet on mobile instead of a side panel */}
      {showHistory && (
        <div style={{ position: "fixed", inset: 0, background: "var(--surface)", zIndex: 70, overflowY: "auto" }}>
          <ExecutionHistoryPanel workflowId={id} onClose={() => setShowHistory(false)} fullScreen />
        </div>
      )}

      {showTemplates && <TemplateGallery onSelect={applyTemplate} onClose={() => setShowTemplates(false)} />}
    </div>
  );
}

export default function BuilderPage() {
  return (
    <ReactFlowProvider>
      <BuilderCanvas />
    </ReactFlowProvider>
  );
}

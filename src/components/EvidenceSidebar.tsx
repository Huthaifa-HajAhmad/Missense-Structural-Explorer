import React, { useCallback } from "react";
import {
  Database, Cpu, Compass, Activity,
  Layers, TrendingUp, ChevronLeft, ChevronRight,
  Dna, FlaskConical, Leaf,
} from "lucide-react";

export type EvidenceTab =
  | "clinical"
  | "predictors"
  | "plm"
  | "meta"
  | "annotation"
  | "conservation"
  | "structure"
  | "function"
  | "energetics";

export type DataStatus = "full" | "partial" | "none" | "always";
export type DataAvailabilityMap = Record<string, DataStatus>;

interface EvidenceSidebarProps {
  activeTab: EvidenceTab;
  isCollapsed: boolean;
  dataAvailability: DataAvailabilityMap;
  onTabChange: (tab: EvidenceTab) => void;
  onToggleCollapse: () => void;
}

interface NavSection {
  id: EvidenceTab;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  subItems?: { id: EvidenceTab; label: string; Icon: React.ComponentType<{ className?: string }> }[];
}

const NAV_SECTIONS: NavSection[] = [
  { id: "clinical",  label: "Population Data", Icon: Database },
  {
    id: "predictors", label: "Predictors",       Icon: Cpu,
    subItems: [
      { id: "plm",          label: "Protein LMs",     Icon: Dna         },
      { id: "meta",         label: "Meta-Predictors", Icon: Layers      },
      { id: "annotation",   label: "Annotation",      Icon: FlaskConical},
      { id: "conservation", label: "Conservation",    Icon: Leaf        },
    ],
  },
  {
    id: "structure",    label: "Structure",     Icon: Compass,
    subItems: [
      { id: "structure_alphafold" as any, label: "Alphafold2",      Icon: Layers },
      { id: "structure_esm" as any,       label: "ESM Multimodal", Icon: Dna    },
    ]
  },
  { id: "function",     label: "Function",      Icon: TrendingUp },
  { id: "energetics",   label: "Energetics",    Icon: Activity   },
];

/** Determines whether a tab's parent section is active */
const isInPredictorsGroup = (tab: EvidenceTab): boolean =>
  ["predictors", "plm", "meta", "annotation", "conservation"].includes(tab);

const isInStructureGroup = (tab: EvidenceTab): boolean =>
  ["structure", "structure_alphafold" as any, "structure_esm" as any].includes(tab);

export default function EvidenceSidebar({
  activeTab,
  isCollapsed,
  dataAvailability,
  onTabChange,
  onToggleCollapse,
}: EvidenceSidebarProps) {
  const getStatus = useCallback(
    (id: string): DataStatus => dataAvailability[id] ?? "none",
    [dataAvailability]
  );

  const predictorsExpanded = isInPredictorsGroup(activeTab) && !isCollapsed;

  return (
    <div
      className={`ev-sidebar ${isCollapsed ? "collapsed" : "expanded"}`}
      aria-label="Evidence navigation"
    >
      <nav className="ev-sidebar-nav" role="navigation">
        {NAV_SECTIONS.map((section) => {
          const { id, label, Icon, subItems } = section;

          // Determine active state: a section is "active" if it's the active tab,
          // or if we're on one of its sub-items (collapsed mode shows parent as active)
          const isParentActive =
            id === activeTab ||
            (isCollapsed && id === "predictors" && isInPredictorsGroup(activeTab)) ||
            (isCollapsed && id === "structure" && isInStructureGroup(activeTab));
          const isSubParentActive =
            !isCollapsed && (
              (id === "predictors" && isInPredictorsGroup(activeTab)) ||
              (id === "structure" && isInStructureGroup(activeTab))
            );

          const status = getStatus(id === "predictors" ? "predictors" : id);

          const isExpandedGroup = 
            (id === "predictors" && isInPredictorsGroup(activeTab)) ||
            (id === "structure" && isInStructureGroup(activeTab));

          return (
            <React.Fragment key={id}>
              {/* Main section button */}
              <button
                type="button"
                className={`ev-nav-item${isParentActive || isSubParentActive ? " active" : ""}`}
                onClick={() => {
                  if (id === "predictors") {
                    onTabChange(isCollapsed ? "predictors" : (activeTab === "predictors" ? "plm" : "predictors"));
                  } else if (id === "structure") {
                    onTabChange(isCollapsed ? "structure" : (activeTab === "structure" ? "structure_alphafold" as any : "structure"));
                  } else {
                    onTabChange(id);
                  }
                }}
                title={isCollapsed ? label : undefined}
                aria-current={isParentActive ? "true" : undefined}
              >
                <span className="ev-nav-icon">
                  <Icon className="w-[14px] h-[14px]" />
                  {/* Data availability dot — inside icon wrapper so it's always visible */}
                  <span className="data-dot" data-status={status} aria-hidden="true" />
                </span>
                <span className="ev-nav-label">{label}</span>
                {/* Inline dot in expanded state (right side) */}
                {!isCollapsed && (
                  <span
                    className="data-dot flex-shrink-0"
                    style={{ marginLeft: "auto" }}
                    data-status={status}
                    aria-label={`Data: ${status}`}
                  />
                )}
              </button>

              {/* Sub-items: only visible when section is expanded AND sidebar is not collapsed */}
              {subItems && !isCollapsed && isExpandedGroup && (
                <div role="group" aria-label="Predictor sub-sections">
                  {subItems.map((sub) => {
                    const SubIcon = sub.Icon;
                    const subStatus = getStatus(sub.id);
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        className={`ev-nav-item sub-item${activeTab === sub.id ? " active" : ""}`}
                        onClick={() => onTabChange(sub.id)}
                        aria-current={activeTab === sub.id ? "true" : undefined}
                      >
                        <span className="ev-nav-icon">
                          <SubIcon className="w-[12px] h-[12px]" />
                        </span>
                        <span className="ev-nav-label">{sub.label}</span>
                        <span
                          className="data-dot flex-shrink-0"
                          style={{ marginLeft: "auto" }}
                          data-status={subStatus}
                          aria-label={`Data: ${subStatus}`}
                        />
                      </button>
                    );
                  })}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </nav>

      {/* Collapse toggle — sticky at bottom */}
      <button
        type="button"
        className="ev-sidebar-toggle"
        onClick={onToggleCollapse}
        title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {isCollapsed
          ? <ChevronRight className="w-3.5 h-3.5" />
          : <ChevronLeft className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

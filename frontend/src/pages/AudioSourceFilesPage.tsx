import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import { useWebSocketSubscription } from "@/hooks/useWebSocket";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  ChevronRight, 
  ChevronDown, 
  Folder, 
  FileAudio, 
  AlertCircle, 
  CheckCircle2,
  RefreshCw,
  Download,
  Search,
  Clock
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SourceFile {
  _id: any;
  path: string;
  ingested: boolean;
  ingestion?: {
    error?: any;
    last_attempt?: any;
  };
}

interface TreeNode {
  name: string;
  fullPath: string;
  children: Record<string, TreeNode>;
  totalCount: number;
  ingestedCount: number;
  errorCount: number;
  type: 'folder' | 'file';
  id?: string;
}

function buildTree(files: SourceFile[]): TreeNode {
  const root: TreeNode = {
    name: "root",
    fullPath: "",
    children: {},
    totalCount: 0,
    ingestedCount: 0,
    errorCount: 0,
    type: 'folder'
  };

  for (const file of files) {
    const path = file.path || "unknown";
    // Split by / or \ for cross-platform compatibility
    const parts = path.split(/[/\\]/).filter(Boolean);
    let current = root;
    
    current.totalCount++;
    if (file.ingested) current.ingestedCount++;
    if (file.ingestion?.error) current.errorCount++;

    let currentPath = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath += (currentPath ? "/" : "") + part;
      const isFile = i === parts.length - 1;

      if (!current.children[part]) {
        current.children[part] = {
          name: part,
          fullPath: currentPath,
          children: {},
          totalCount: 0,
          ingestedCount: 0,
          errorCount: 0,
          type: isFile ? 'file' : 'folder',
          id: isFile ? file._id?.toString() : undefined
        };
      }
      
      const node = current.children[part];
      node.totalCount++;
      if (file.ingested) node.ingestedCount++;
      if (file.ingestion?.error) node.errorCount++;
      
      current = node;
    }
  }

  return root;
}

function collapseTree(node: TreeNode): TreeNode {
  const childrenKeys = Object.keys(node.children);
  
  // Recursively collapse children first
  for (const key of childrenKeys) {
    node.children[key] = collapseTree(node.children[key]);
  }

  // If this node has exactly one child and it's a folder, collapse it
  if (childrenKeys.length === 1) {
    const singleChildKey = childrenKeys[0];
    const child = node.children[singleChildKey];
    
    if (child.type === 'folder') {
      return {
        ...child,
        name: `${node.name}/${child.name}`,
        // Keep the node's original counts if they differ (though they shouldn't for single-child folders)
        totalCount: node.totalCount,
        ingestedCount: node.ingestedCount,
        errorCount: node.errorCount,
        id: child.id // Ensure ID is carried over if it's a file (though folders shouldn't have IDs here)
      };
    }
  }

  return node;
}

const TreeItem = ({ node, level = 0 }: { node: TreeNode; level?: number }) => {
  const [isExpanded, setIsExpanded] = useState(level === 0);
  const hasChildren = Object.keys(node.children).length > 0;
  
  const sortedChildren = useMemo(() => {
    return Object.values(node.children).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [node.children]);

  const allIngested = node.ingestedCount === node.totalCount;
  const someIngested = node.ingestedCount > 0;

  const content = (
    <div 
      className={cn(
        "flex items-center py-1 px-2 hover:bg-accent rounded-sm cursor-pointer text-sm group",
        level === 0 && "font-semibold bg-muted/50"
      )}
      style={{ paddingLeft: `${level * 1.25}rem` }}
      onClick={() => node.type === 'folder' && setIsExpanded(!isExpanded)}
    >
      <span className="w-4 h-4 mr-1 flex items-center justify-center">
        {hasChildren ? (
          isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />
        ) : null}
      </span>
      
      <span className="mr-2 text-muted-foreground">
        {node.type === 'folder' ? (
          <Folder className={cn("w-4 h-4", isExpanded && "fill-current opacity-20")} />
        ) : (
          <FileAudio className="w-4 h-4" />
        )}
      </span>
      
      <span className="flex-1 truncate">{node.name}</span>
      
      <div className="flex items-center gap-4 ml-4 opacity-70 group-hover:opacity-100 transition-opacity whitespace-nowrap">
        <div className="flex items-center gap-1.5 min-w-[60px] justify-end">
          <span className="text-[10px] text-muted-foreground uppercase font-medium">Ingested</span>
          <CheckCircle2 className={cn(
            "w-3.5 h-3.5", 
            allIngested ? "text-green-500" : someIngested ? "text-yellow-500" : "text-muted-foreground"
          )} />
          <span className={cn(
            "font-mono text-xs",
            allIngested ? "text-green-600 dark:text-green-400" : someIngested ? "text-yellow-600 dark:text-yellow-400" : ""
          )}>
            {node.ingestedCount}/{node.totalCount}
          </span>
        </div>
        
        <div className="flex items-center gap-1.5 min-w-[40px] justify-end">
          <span className="text-[10px] text-muted-foreground uppercase font-medium">Errors</span>
          <AlertCircle className={cn(
            "w-3.5 h-3.5", 
            node.errorCount > 0 ? "text-destructive" : "text-muted-foreground opacity-30"
          )} />
          <span className={cn(
            "font-mono text-xs",
            node.errorCount > 0 ? "text-destructive" : "text-muted-foreground opacity-30"
          )}>
            {node.errorCount}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="select-none">
      {node.type === 'file' && node.id ? (
        <Link to={`/audio/source_files/${node.id}`}>
          {content}
        </Link>
      ) : content}
      
      {isExpanded && hasChildren && (
        <div className="mt-0.5">
          {sortedChildren.map(child => (
            <TreeItem key={child.fullPath} node={child} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export default function AudioSourceFilesPage() {
  const queryClient = useQueryClient();
  
  // Use React Query cache to persist files across detail page navigation
  const { data: fetchedFiles = [] } = useQuery<SourceFile[]>({
    queryKey: ["source-files-list"],
    queryFn: () => queryClient.getQueryData<SourceFile[]>(["source-files-list"]) ?? [],
    staleTime: Infinity, // Don't re-fetch automatically while on page
    gcTime: 1000 * 60 * 10, // Keep in cache for 10 minutes
  });

  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<'all' | 'ingested' | 'error' | 'pending'>('all');

  const setFetchedFiles = (updater: (prev: SourceFile[]) => SourceFile[]) => {
    queryClient.setQueryData<SourceFile[]>(["source-files-list"], (old = []) => updater(old));
  };

  const fetchInBatches = async () => {
    setIsDownloading(true);
    setError(null);
    setFetchedFiles(() => []);
    
    try {
      const count = await api.callResource("mongo", {
        action: "count",
        collection: "source_files",
        query: {}
      });
      
      const total = typeof count === 'number' ? count : (count?.count ?? 0);
      setTotalCount(total);
      
      const batchSize = 1000;
      const all: SourceFile[] = [];
      
      for (let skip = 0; skip < total; skip += batchSize) {
        const batch = await api.callResource("mongo", {
          action: "find",
          collection: "source_files",
          query: {},
          options: {
            limit: batchSize,
            skip: skip,
            projection: {
              _id: 1,
              path: 1,
              ingested: 1,
              "ingestion.error": 1
            }
          }
        });
        
        all.push(...batch);
        setFetchedFiles(() => [...all]);
      }
    } catch (err: any) {
      console.error("Failed to fetch source files:", err);
      setError(err.message || "Failed to download records");
    } finally {
      setIsDownloading(false);
    }
  };

  useEffect(() => {
    // Only fetch if we don't have data yet
    if (fetchedFiles.length === 0) {
      fetchInBatches();
    }
  }, []);

  // Handle "only re-fetch all data when leaving the page"
  useEffect(() => {
    return () => {
      // If we are navigating away from the source files area entirely
      const currentPath = window.location.pathname;
      if (!currentPath.startsWith("/audio/source_files")) {
        queryClient.invalidateQueries({ queryKey: ["source-files-list"] });
      }
    };
  }, [queryClient]);

  useWebSocketSubscription("mongo:source_files", (event) => {
    if (event.event === "mongo.change") {
      const change = event.data;
      if (!change || change.collection !== "source_files") return;

      const docId = change.documentId;
      const operationType = change.operationType;
      const document = change.document;

      setFetchedFiles((prev) => {
        const existingIndex = prev.findIndex(f => f._id?.toString() === docId);
        
        if (operationType === "insert" && document) {
          if (existingIndex === -1) {
            return [...prev, document];
          }
        } else if ((operationType === "update" || operationType === "replace") && document) {
          if (existingIndex !== -1) {
            const next = [...prev];
            next[existingIndex] = { ...next[existingIndex], ...document };
            return next;
          }
        } else if (operationType === "delete") {
          if (existingIndex !== -1) {
            const next = [...prev];
            next.splice(existingIndex, 1);
            return next;
          }
        }
        return prev;
      });

      if (operationType === "insert") {
        setTotalCount(t => (t !== null ? t + 1 : null));
      } else if (operationType === "delete") {
        setTotalCount(t => (t !== null ? t - 1 : null));
      }
    }
  });

  const tree = useMemo(() => {
    if (fetchedFiles.length === 0) return null;
    
    let filteredFiles = fetchedFiles;
    
    // Apply status filter
    if (statusFilter === 'ingested') {
      filteredFiles = filteredFiles.filter(f => f.ingested);
    } else if (statusFilter === 'error') {
      filteredFiles = filteredFiles.filter(f => f.ingestion?.error);
    } else if (statusFilter === 'pending') {
      filteredFiles = filteredFiles.filter(f => !f.ingested && !f.ingestion?.error);
    }

    // Apply search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filteredFiles = filteredFiles.filter(f => f.path.toLowerCase().includes(query));
    }
    
    const fullTree = buildTree(filteredFiles);
    
    // Collapse all children of root, but don't collapse root itself into its children
    const childrenKeys = Object.keys(fullTree.children);
    for (const key of childrenKeys) {
      fullTree.children[key] = collapseTree(fullTree.children[key]);
    }
    
    return fullTree;
  }, [fetchedFiles, searchQuery, statusFilter]);

  // Original tree stats for the chips
  const baseStats = useMemo(() => {
    if (fetchedFiles.length === 0) return { ingested: 0, error: 0, pending: 0, total: 0 };
    let ingested = 0;
    let error = 0;
    let pending = 0;
    for (const f of fetchedFiles) {
      if (f.ingested) ingested++;
      else if (f.ingestion?.error) error++;
      else pending++;
    }
    return { ingested, error, pending, total: fetchedFiles.length };
  }, [fetchedFiles]);

  const progress = totalCount ? (fetchedFiles.length / totalCount) * 100 : 0;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audio Source Files</h1>
          <p className="text-muted-foreground mt-1">
            Hierarchy of discovered audio files and their ingestion status.
          </p>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => fetchInBatches()}
          disabled={isDownloading}
        >
          <RefreshCw className={cn("h-4 w-4 mr-2", isDownloading && "animate-spin")} />
          {isDownloading ? "Downloading..." : "Refresh"}
        </Button>
      </div>

      {isDownloading && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-6 pb-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Download className="w-4 h-4 animate-bounce text-primary" />
                  <span className="font-medium">Downloading records in batches...</span>
                </div>
                <span className="font-mono text-muted-foreground">
                  {fetchedFiles.length} / {totalCount ?? "?"}
                </span>
              </div>
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">
                Fetching records 1000 at a time to ensure stability with large datasets.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-destructive/20 bg-destructive/5">
          <CardContent className="pt-4 pb-4 flex items-center gap-3 text-destructive">
            <AlertCircle className="w-5 h-5" />
            <div className="flex-1 text-sm font-medium">{error}</div>
            <Button size="sm" variant="outline" onClick={() => fetchInBatches()}>Try Again</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3 border-b">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <CardTitle className="text-lg font-medium whitespace-nowrap">Source File Hierarchy</CardTitle>
            
            <div className="flex flex-1 items-center gap-3 md:gap-4 max-w-2xl">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Filter paths..."
                  className="pl-8 h-9"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              
              <div className="flex items-center gap-2">
                <Badge 
                  variant={statusFilter === 'all' ? 'default' : 'outline'}
                  className="cursor-pointer hover:bg-primary/90 whitespace-nowrap"
                  onClick={() => setStatusFilter('all')}
                >
                  Total: {baseStats.total}
                </Badge>
                
                <Badge 
                  variant={statusFilter === 'ingested' ? 'default' : 'outline'}
                  className={cn(
                    "cursor-pointer whitespace-nowrap transition-colors",
                    statusFilter === 'ingested' ? "bg-green-600 hover:bg-green-700" : "hover:bg-green-50 text-green-600 border-green-200"
                  )}
                  onClick={() => setStatusFilter(statusFilter === 'ingested' ? 'all' : 'ingested')}
                >
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Ingested: {baseStats.ingested}
                </Badge>

                <Badge 
                  variant={statusFilter === 'error' ? 'default' : 'outline'}
                  className={cn(
                    "cursor-pointer whitespace-nowrap transition-colors",
                    statusFilter === 'error' ? "bg-destructive hover:bg-destructive/90" : "hover:bg-red-50 text-destructive border-red-200"
                  )}
                  onClick={() => setStatusFilter(statusFilter === 'error' ? 'all' : 'error')}
                >
                  <AlertCircle className="w-3 h-3 mr-1" />
                  Errors: {baseStats.error}
                </Badge>

                <Badge 
                  variant={statusFilter === 'pending' ? 'default' : 'outline'}
                  className={cn(
                    "cursor-pointer whitespace-nowrap transition-colors",
                    statusFilter === 'pending' ? "bg-yellow-600 hover:bg-yellow-700" : "hover:bg-yellow-50 text-yellow-600 border-yellow-200"
                  )}
                  onClick={() => setStatusFilter(statusFilter === 'pending' ? 'all' : 'pending')}
                >
                  <Clock className="w-3 h-3 mr-1" />
                  Pending: {baseStats.pending}
                </Badge>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          {fetchedFiles.length === 0 && isDownloading ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-4">
              <RefreshCw className="h-10 w-10 animate-spin text-primary opacity-50" />
              <p className="text-muted-foreground animate-pulse">Initializing download...</p>
            </div>
          ) : tree && tree.totalCount > 0 ? (
            <div className="border rounded-lg bg-card overflow-hidden shadow-sm">
               <div className="p-2 max-h-[75vh] overflow-y-auto">
                  {Object.values(tree.children).length > 0 ? (
                    Object.values(tree.children)
                      .sort((a, b) => {
                        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
                        return a.name.localeCompare(b.name);
                      })
                      .map(node => <TreeItem key={node.fullPath} node={node} />)
                  ) : (
                    <TreeItem node={tree} />
                  )}
               </div>
            </div>
          ) : !isDownloading ? (
            <div className="text-center py-20 border-2 border-dashed rounded-lg">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted mb-4">
                <Folder className="w-6 h-6 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium">No source files found</h3>
              <p className="text-muted-foreground max-w-xs mx-auto mt-2">
                We couldn't find any source files in the database. 
                Make sure the discovery process is running.
              </p>
              <Button variant="outline" className="mt-6" onClick={() => fetchInBatches()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Try again
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

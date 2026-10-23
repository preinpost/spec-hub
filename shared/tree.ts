// 평평한 분류 목록을 대 · 중 · 소 트리로 묶는다. 웹 사이드바와 MCP 가 함께 쓴다.
import type { Category, FeatureSummary } from './api';

export interface TreeNode {
  category: Category;
  children: TreeNode[];
  features: FeatureSummary[];
}

export function buildTree(categories: Category[], features: FeatureSummary[]): { roots: TreeNode[]; uncategorized: FeatureSummary[] } {
  const nodes = new Map<number, TreeNode>();
  for (const c of categories) nodes.set(c.id, { category: c, children: [], features: [] });
  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.category.parentId === null ? undefined : nodes.get(node.category.parentId);
    (parent ? parent.children : roots).push(node);
  }
  const uncategorized: FeatureSummary[] = [];
  for (const f of features) {
    const node = f.categoryId === null ? undefined : nodes.get(f.categoryId);
    (node ? node.features : uncategorized).push(f);
  }
  const sort = (list: TreeNode[]) => {
    list.sort((a, b) => a.category.sortOrder - b.category.sortOrder || a.category.id - b.category.id);
    for (const n of list) sort(n.children);
  };
  sort(roots);
  return { roots, uncategorized };
}

/** 대분류부터 id 까지의 분류. 없는 id 면 빈 배열. */
export function ancestorsOf(categories: Category[], id: number | null): Category[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const path: Category[] = [];
  let current = id === null ? undefined : byId.get(id);
  while (current) {
    path.unshift(current);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return path;
}

/** 노드와 그 아래 모든 기능. 접힌 분류 옆에 합계를 보여 줄 때 쓴다. */
export function allFeatures(node: TreeNode): FeatureSummary[] {
  return [...node.features, ...node.children.flatMap(allFeatures)];
}

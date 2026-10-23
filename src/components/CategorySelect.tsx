import { useMemo } from 'react';

import type { Category } from '../../shared/api';
import { type TreeNode, buildTree } from '../../shared/tree';

/** 분류 선택. 깊이만큼 들여 써서 대 · 중 · 소를 구분한다. */
export function CategorySelect({
  categories,
  value,
  onChange,
}: {
  categories: Category[];
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  const options = useMemo(() => {
    const out: { id: number; label: string }[] = [];
    const walk = (node: TreeNode) => {
      out.push({ id: node.category.id, label: `${'\u3000'.repeat(node.category.depth - 1)}${node.category.depth > 1 ? '└ ' : ''}${node.category.name}` });
      node.children.forEach(walk);
    };
    buildTree(categories, []).roots.forEach(walk);
    return out;
  }, [categories]);

  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      aria-label="분류 선택"
      className="form-control"
    >
      <option value="">미분류</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

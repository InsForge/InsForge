import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ExplainSQLResponse } from '@insforge/shared-schemas';
import { ExplainPlanTree } from '#features/database/components/ExplainPlanTree';

describe('ExplainPlanTree', () => {
  it('renders plan metrics and child nodes', () => {
    const data: ExplainSQLResponse = {
      planningTime: 0.25,
      executionTime: 0.5,
      totalQueryTime: 0.75,
      rolledBack: true,
      plan: {
        nodeType: 'Nested Loop',
        startupCost: 0,
        totalCost: 12.5,
        planRows: 5,
        actualStartupTime: 0.01,
        actualTotalTime: 0.03,
        actualRows: 4,
        plans: [
          {
            nodeType: 'Index Scan',
            relationName: 'products',
            indexName: 'products_pkey',
            planRows: 1,
            actualRows: 1,
            plans: [],
          },
        ],
      },
    };

    render(<ExplainPlanTree data={data} />);

    expect(screen.getByText('Total time')).toBeTruthy();
    expect(screen.getByText('0.750 ms')).toBeTruthy();
    expect(screen.getByText('Rolled back')).toBeTruthy();
    expect(screen.getByText('Nested Loop')).toBeTruthy();
    expect(screen.getByText('Index Scan')).toBeTruthy();
    expect(screen.getByText('products')).toBeTruthy();
    expect(screen.getByText('Index: products_pkey')).toBeTruthy();
  });
});

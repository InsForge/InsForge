import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('deployments route wiring', () => {
  const deploymentsRouteSource = readFileSync(
    resolve(__dirname, '../../src/api/routes/deployments/index.routes.ts'),
    'utf-8'
  );

  it('mounts env-vars before parameterized deployment routes', () => {
    const envVarsMountIndex = deploymentsRouteSource.indexOf(
      "router.use('/env-vars', envVarsRouter);"
    );
    const deploymentIdRouteIndex = deploymentsRouteSource.indexOf("router.get('/:id'");

    expect(envVarsMountIndex).toBeGreaterThan(-1);
    expect(deploymentIdRouteIndex).toBeGreaterThan(-1);
    expect(envVarsMountIndex).toBeLessThan(deploymentIdRouteIndex);
  });

  it('validates deployment ids before service calls on parameterized routes', () => {
    expect(deploymentsRouteSource).toContain('function parseDeploymentId(id: string): string');
    expect(deploymentsRouteSource).toContain(
      "throw new AppError('Invalid deployment ID', 400, ERROR_CODES.INVALID_INPUT);"
    );
    expect(deploymentsRouteSource).toContain('const id = parseDeploymentId(req.params.id);');
    expect(deploymentsRouteSource).toMatch(
      /router\.get\('\/:id'[\s\S]*const id = parseDeploymentId\(req\.params\.id\);[\s\S]*deploymentService\.getDeploymentById\(id\)/
    );
    expect(deploymentsRouteSource).toMatch(
      /router\.post\(\s*'\/:id\/sync'[\s\S]*const id = parseDeploymentId\(req\.params\.id\);[\s\S]*deploymentService\.syncDeploymentById\(id\)/
    );
    expect(deploymentsRouteSource).toMatch(
      /router\.post\(\s*'\/:id\/cancel'[\s\S]*const id = parseDeploymentId\(req\.params\.id\);[\s\S]*deploymentService\.cancelDeploymentById\(id\)/
    );
    expect(deploymentsRouteSource).toMatch(
      /router\.post\(\s*'\/:id\/start'[\s\S]*const id = parseDeploymentId\(req\.params\.id\);[\s\S]*deploymentService\.startDeployment\(id, validationResult\.data\)/
    );
  });
});

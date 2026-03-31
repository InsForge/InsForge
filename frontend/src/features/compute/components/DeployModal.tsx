import { useEffect, useState } from 'react';
import type { CreateContainerRequest, SourceType } from '@insforge/shared-schemas';
import {
  Button,
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@insforge/ui';

interface DeployModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateContainerRequest) => void;
  isSubmitting: boolean;
}

export function DeployModal({ open, onOpenChange, onSubmit, isSubmitting }: DeployModalProps) {
  const [sourceType, setSourceType] = useState<SourceType>('github');
  const [name, setName] = useState('');
  const [githubRepo, setGithubRepo] = useState('');
  const [githubBranch, setGithubBranch] = useState('main');
  const [dockerfilePath, setDockerfilePath] = useState('./Dockerfile');
  const [imageUrl, setImageUrl] = useState('');
  const [port, setPort] = useState('8080');
  const [healthCheckPath, setHealthCheckPath] = useState('/health');

  useEffect(() => {
    if (open) {
      setSourceType('github');
      setName('');
      setGithubRepo('');
      setGithubBranch('main');
      setDockerfilePath('./Dockerfile');
      setImageUrl('');
      setPort('8080');
      setHealthCheckPath('/health');
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedPort = parseInt(port, 10);
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      return;
    }

    const base = {
      name: name.trim(),
      sourceType,
      port: parsedPort,
      healthCheckPath,
      cpu: 256 as number,
      memory: 512 as number,
      autoDeploy: true,
    };

    onSubmit({
      ...base,
      githubRepo: sourceType === 'github' ? githubRepo : undefined,
      githubBranch,
      dockerfilePath,
      imageUrl: sourceType === 'image' ? imageUrl : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Deploy Container</DialogTitle>
          <DialogCloseButton onClick={() => onOpenChange(false)} />
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <DialogBody className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-service"
                required
              />
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Source</label>
              <div className="flex gap-2 mt-1">
                <Button
                  type="button"
                  variant={sourceType === 'github' ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => setSourceType('github')}
                >
                  GitHub
                </Button>
                <Button
                  type="button"
                  variant={sourceType === 'image' ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => setSourceType('image')}
                >
                  Docker Image
                </Button>
              </div>
            </div>

            {sourceType === 'github' ? (
              <>
                <div>
                  <label className="text-sm font-medium text-foreground">Repository</label>
                  <Input
                    value={githubRepo}
                    onChange={(e) => setGithubRepo(e.target.value)}
                    placeholder="owner/repo"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-foreground">Branch</label>
                    <Input value={githubBranch} onChange={(e) => setGithubBranch(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-foreground">Dockerfile</label>
                    <Input
                      value={dockerfilePath}
                      onChange={(e) => setDockerfilePath(e.target.value)}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div>
                <label className="text-sm font-medium text-foreground">Image URL</label>
                <Input
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="docker.io/myimage:latest"
                  required
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium text-foreground">Port</label>
                <Input value={port} onChange={(e) => setPort(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Health Check Path</label>
                <Input
                  value={healthCheckPath}
                  onChange={(e) => setHealthCheckPath(e.target.value)}
                />
              </div>
            </div>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create & Deploy'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

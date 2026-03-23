import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogCloseButton,
  Button,
  Input,
} from '@insforge/ui';
import { CreateContainerRequest } from '@insforge/shared-schemas';

interface DeployModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateContainerRequest) => void;
  isSubmitting?: boolean;
}

type SourceType = 'github' | 'image';

export function DeployModal({ open, onOpenChange, onSubmit, isSubmitting }: DeployModalProps) {
  const [sourceType, setSourceType] = useState<SourceType>('github');
  const [name, setName] = useState('');
  const [githubRepo, setGithubRepo] = useState('');
  const [githubBranch, setGithubBranch] = useState('main');
  const [dockerfilePath, setDockerfilePath] = useState('./Dockerfile');
  const [imageUrl, setImageUrl] = useState('');
  const [port, setPort] = useState('8080');
  const [healthCheckPath, setHealthCheckPath] = useState('/health');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const base = {
      name: name.trim(),
      sourceType: sourceType,
      port: parseInt(port, 10),
      healthCheckPath: healthCheckPath,
      dockerfilePath: dockerfilePath,
      cpu: 256,
      memory: 512,
      autoDeploy: true,
    };

    if (sourceType === 'github') {
      onSubmit({
        ...base,
        githubRepo: githubRepo,
        githubBranch: githubBranch,
      });
    } else {
      onSubmit({
        ...base,
        imageUrl: imageUrl,
      });
    }
  };

  const handleClose = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Deploy Container</DialogTitle>
          <DialogCloseButton onClick={handleClose} />
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <DialogBody className="flex flex-col gap-4">
            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Container Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-container"
                required
              />
              <p className="text-xs text-muted-foreground">
                Lowercase alphanumeric with hyphens only.
              </p>
            </div>

            {/* Source toggle */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">Source</label>
              <div className="flex rounded border border-[var(--alpha-8)] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setSourceType('github')}
                  className={`flex-1 py-1.5 text-sm font-medium transition-colors ${
                    sourceType === 'github'
                      ? 'bg-foreground text-background'
                      : 'bg-card text-muted-foreground hover:bg-[var(--alpha-4)]'
                  }`}
                >
                  GitHub Repo
                </button>
                <button
                  type="button"
                  onClick={() => setSourceType('image')}
                  className={`flex-1 py-1.5 text-sm font-medium transition-colors ${
                    sourceType === 'image'
                      ? 'bg-foreground text-background'
                      : 'bg-card text-muted-foreground hover:bg-[var(--alpha-4)]'
                  }`}
                >
                  Image URL
                </button>
              </div>
            </div>

            {/* GitHub fields */}
            {sourceType === 'github' && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-foreground">Repository</label>
                  <Input
                    value={githubRepo}
                    onChange={(e) => setGithubRepo(e.target.value)}
                    placeholder="owner/repo"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-foreground">Branch</label>
                  <Input
                    value={githubBranch}
                    onChange={(e) => setGithubBranch(e.target.value)}
                    placeholder="main"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-foreground">Dockerfile Path</label>
                  <Input
                    value={dockerfilePath}
                    onChange={(e) => setDockerfilePath(e.target.value)}
                    placeholder="./Dockerfile"
                  />
                </div>
              </>
            )}

            {/* Image field */}
            {sourceType === 'image' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">Image URL</label>
                <Input
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="docker.io/myorg/myimage:latest"
                  required
                />
              </div>
            )}

            {/* Common fields */}
            <div className="flex gap-3">
              <div className="flex-1 flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">Port</label>
                <Input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="8080"
                  min={1}
                  max={65535}
                  required
                />
              </div>
              <div className="flex-1 flex flex-col gap-1.5">
                <label className="text-sm font-medium text-foreground">Health Check Path</label>
                <Input
                  value={healthCheckPath}
                  onChange={(e) => setHealthCheckPath(e.target.value)}
                  placeholder="/health"
                />
              </div>
            </div>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Deploying...' : 'Deploy'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

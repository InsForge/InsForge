import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/radix/Dialog';
import { Button } from '@/components/radix/Button';
import { Badge } from '@/components/radix/Badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/radix/Tabs';
import { Copy, Code2, Info, Clock, Activity, AlertCircle } from 'lucide-react';
import { useToast } from '@/lib/hooks/useToast';
import { type EdgeFunction } from '../services/functions.service';

interface FunctionDetailDialogProps {
  isOpen: boolean;
  onClose: () => void;
  function: EdgeFunction;
}

export default function FunctionDetailDialog({
  isOpen,
  onClose,
  function: func,
}: FunctionDetailDialogProps) {
  const { showToast } = useToast();

  const handleCopyCode = () => {
    if (func.code) {
      navigator.clipboard.writeText(func.code);
      showToast('Code copied to clipboard', 'success');
    }
  };

  const handleCopyEndpoint = () => {
    const endpoint = `${window.location.origin}/api/functions/run/${func.slug}`;
    navigator.clipboard.writeText(endpoint);
    showToast('Endpoint URL copied to clipboard', 'success');
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<
      string,
      { variant: 'default' | 'secondary' | 'destructive'; icon: React.ReactNode }
    > = {
      active: { variant: 'default', icon: <Activity className="w-3 h-3 mr-1" /> },
      draft: { variant: 'secondary', icon: <Clock className="w-3 h-3 mr-1" /> },
      error: { variant: 'destructive', icon: <AlertCircle className="w-3 h-3 mr-1" /> },
    };

    const config = variants[status] || variants.draft;

    return (
      <Badge variant={config.variant} className="flex items-center">
        {config.icon}
        {status}
      </Badge>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex justify-between items-start">
            <div>
              <DialogTitle className="text-xl flex items-center gap-2">
                <Code2 className="w-5 h-5" />
                {func.name}
              </DialogTitle>
              <DialogDescription className="mt-2 flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <code className="text-sm bg-muted px-2 py-0.5 rounded">/{func.slug}</code>
                  <Button variant="ghost" size="sm" onClick={handleCopyEndpoint} className="h-6">
                    <Copy className="w-3 h-3 mr-1" />
                    Copy Endpoint
                  </Button>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  {getStatusBadge(func.status)}
                  {func.deployed_at && (
                    <span className="text-xs text-muted-foreground">
                      Last deployed: {new Date(func.deployed_at).toLocaleString()}
                    </span>
                  )}
                </div>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          <Tabs defaultValue="code" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="code" className="flex items-center gap-1">
                <Code2 className="w-4 h-4" />
                Code
              </TabsTrigger>
              <TabsTrigger value="info" className="flex items-center gap-1">
                <Info className="w-4 h-4" />
                Details
              </TabsTrigger>
            </TabsList>

            <TabsContent value="code" className="space-y-4">
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute top-2 right-2 z-10"
                  onClick={handleCopyCode}
                >
                  <Copy className="w-3 h-3 mr-1" />
                  Copy
                </Button>
                <pre className="bg-muted p-4 rounded-lg overflow-auto">
                  <code className="text-sm font-mono">{func.code || '// No code available'}</code>
                </pre>
              </div>
            </TabsContent>

            <TabsContent value="info" className="space-y-4">
              <div className="grid gap-4">
                <div className="space-y-2">
                  <h3 className="font-semibold">Description</h3>
                  <p className="text-sm text-muted-foreground">
                    {func.description || 'No description available'}
                  </p>
                </div>

                <div className="space-y-2">
                  <h3 className="font-semibold">Status</h3>
                  {getStatusBadge(func.status)}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <h3 className="font-semibold">Created</h3>
                    <p className="text-sm text-muted-foreground">
                      {new Date(func.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <h3 className="font-semibold">Last Updated</h3>
                    <p className="text-sm text-muted-foreground">
                      {new Date(func.updated_at).toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="font-semibold">Endpoint URL</h3>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-muted px-3 py-2 rounded">
                      {window.location.origin}/api/functions/run/{func.slug}
                    </code>
                    <Button variant="outline" size="sm" onClick={handleCopyEndpoint}>
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}

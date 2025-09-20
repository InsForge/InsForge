import { useState, useEffect } from 'react';
import { 
  Code2, 
  Search, 
  ChevronRight, 
  Activity,
  AlertCircle,
  Clock
} from 'lucide-react';
import { Input } from '@/components/radix/Input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/radix/Card';
import { Badge } from '@/components/radix/Badge';
import { Skeleton } from '@/components/radix/Skeleton';
import { useToast } from '@/lib/hooks/useToast';
import FunctionDetailDialog from '../components/FunctionDetailDialog';
import { functionsService, type EdgeFunction } from '../services/functions.service';

export default function FunctionsPage() {
  const [functions, setFunctions] = useState<EdgeFunction[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFunction, setSelectedFunction] = useState<EdgeFunction | null>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const { showError } = useToast();

  const fetchFunctions = async () => {
    try {
      const data = await functionsService.listFunctions();
      setFunctions(data);
    } catch (error) {
      console.error('Failed to fetch functions:', error);
      showError('Failed to load functions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFunctions();
  }, []);

  const handleFunctionClick = async (func: EdgeFunction) => {
    try {
      const data = await functionsService.getFunctionBySlug(func.slug);
      setSelectedFunction(data);
      setShowDetailDialog(true);
    } catch (error) {
      console.error('Failed to fetch function details:', error);
      showError('Failed to load function details');
    }
  };

  const filteredFunctions = functions.filter(func =>
    func.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    func.slug.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (func.description && func.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline', icon: React.ReactNode }> = {
      active: { variant: 'default', icon: <Activity className="w-3 h-3 mr-1" /> },
      draft: { variant: 'secondary', icon: <Clock className="w-3 h-3 mr-1" /> },
      error: { variant: 'destructive', icon: <AlertCircle className="w-3 h-3 mr-1" /> }
    };
    
    const config = variants[status] || variants.draft;
    
    return (
      <Badge variant={config.variant} className="flex items-center">
        {config.icon}
        {status}
      </Badge>
    );
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="flex justify-between items-center mb-6">
          <Skeleton className="h-10 w-48" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-3xl font-bold text-zinc-950 dark:text-white">Edge Functions</h1>
          <p className="text-muted-foreground mt-1">
            View and manage serverless functions
          </p>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            type="text"
            placeholder="Search functions by name, slug, or description..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {filteredFunctions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Code2 className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">
              {searchTerm ? 'No functions found' : 'No functions available'}
            </h3>
            <p className="text-muted-foreground text-center">
              {searchTerm 
                ? 'Try adjusting your search terms' 
                : 'No edge functions have been created yet'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredFunctions.map((func) => (
            <Card 
              key={func.id} 
              className="cursor-pointer hover:shadow-lg transition-shadow group"
              onClick={() => handleFunctionClick(func)}
            >
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <CardTitle className="text-lg flex items-center gap-2">
                      {func.name}
                      <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </CardTitle>
                    <code className="text-sm text-muted-foreground mt-1 block bg-muted px-2 py-1 rounded">
                      /{func.slug}
                    </code>
                  </div>
                  {getStatusBadge(func.status)}
                </div>
              </CardHeader>
              <CardContent>
                {func.description && (
                  <CardDescription className="mb-3">
                    {func.description}
                  </CardDescription>
                )}
                <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                  <div>Created: {new Date(func.created_at).toLocaleDateString()}</div>
                  {func.deployed_at && (
                    <div>Deployed: {new Date(func.deployed_at).toLocaleDateString()}</div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedFunction && (
        <FunctionDetailDialog
          isOpen={showDetailDialog}
          onClose={() => {
            setShowDetailDialog(false);
            setSelectedFunction(null);
          }}
          function={selectedFunction}
        />
      )}
    </div>
  );
}
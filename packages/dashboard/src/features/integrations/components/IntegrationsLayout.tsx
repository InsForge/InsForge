import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { IntegrationsSidebar } from './IntegrationsSidebar';

export const IntegrationsLayout = () => {
  const [activeTab, setActiveTab] = useState<'published' | 'authorized'>('published');

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[rgb(var(--semantic-1))]">
      <IntegrationsSidebar />
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="flex h-full w-full flex-col">
          <div className="flex-none px-6 py-4 border-b border-[var(--alpha-8)] bg-[rgb(var(--semantic-0))]">
            <h1 className="text-2xl text-foreground">Integrations</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage your third-party OAuth applications and project authorizations.
            </p>
          </div>

          <div className="flex-none px-6 pt-4 border-b border-[var(--alpha-8)] bg-[rgb(var(--semantic-0))]">
            <nav className="flex space-x-6">
              <button
                onClick={() => setActiveTab('published')}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'published'
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-[var(--alpha-8)]'
                }`}
              >
                Published Apps
              </button>
              <button
                onClick={() => setActiveTab('authorized')}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'authorized'
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-[var(--alpha-8)]'
                }`}
              >
                Authorized Apps
              </button>
            </nav>
          </div>

          <div className="flex-1 overflow-auto p-6 bg-[rgb(var(--semantic-1))]">
            {activeTab === 'published' ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base text-foreground">Your Applications</h3>
                    <p className="text-sm text-muted-foreground">
                      Applications you have built that can request access to InsForge projects.
                    </p>
                  </div>
                  <button className="px-3 py-2 bg-foreground text-background rounded-md text-sm font-medium hover:opacity-90 transition-opacity">
                    Add an App
                  </button>
                </div>
                
                <div className="border border-[var(--alpha-8)] rounded-md p-8 text-center bg-[rgb(var(--semantic-0))] mt-4">
                  <p className="text-sm text-muted-foreground">
                    No results found. You do not have any published applications yet.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base text-foreground">Authorized Apps</h3>
                  <p className="text-sm text-muted-foreground">
                    Applications that have access to your organization's settings and projects.
                  </p>
                </div>
                
                <div className="border border-[var(--alpha-8)] rounded-md p-8 text-center bg-[rgb(var(--semantic-0))] mt-4">
                  <p className="text-sm text-muted-foreground">
                    No results found. You do not have any authorized applications yet.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

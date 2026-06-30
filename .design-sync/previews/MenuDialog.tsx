import {
  MenuDialog,
  MenuDialogContent,
  MenuDialogSideNav,
  MenuDialogSideNavHeader,
  MenuDialogSideNavTitle,
  MenuDialogNav,
  MenuDialogNavList,
  MenuDialogNavItem,
  MenuDialogMain,
  MenuDialogHeader,
  MenuDialogTitle,
  MenuDialogBody,
  MenuDialogFooter,
  MenuDialogCloseButton,
  Button,
  InputField,
} from '@insforge/ui';
import { Settings, CreditCard, Users, Bell, KeyRound } from 'lucide-react';

// Settings-style modal: sidebar nav + main panel (overlay). cfg.overrides.MenuDialog
// pins single + a large viewport.
export const Settings_ = () => (
  <MenuDialog open>
    <MenuDialogContent>
      <MenuDialogSideNav>
        <MenuDialogSideNavHeader>
          <MenuDialogSideNavTitle>Settings</MenuDialogSideNavTitle>
        </MenuDialogSideNavHeader>
        <MenuDialogNav>
          <MenuDialogNavList>
            <MenuDialogNavItem active icon={<Settings />}>
              General
            </MenuDialogNavItem>
            <MenuDialogNavItem icon={<Users />}>Members</MenuDialogNavItem>
            <MenuDialogNavItem icon={<CreditCard />}>Billing</MenuDialogNavItem>
            <MenuDialogNavItem icon={<KeyRound />}>API keys</MenuDialogNavItem>
            <MenuDialogNavItem icon={<Bell />}>Notifications</MenuDialogNavItem>
          </MenuDialogNavList>
        </MenuDialogNav>
      </MenuDialogSideNav>
      <MenuDialogMain>
        <MenuDialogHeader>
          <MenuDialogTitle>General</MenuDialogTitle>
          <MenuDialogCloseButton className="ml-auto" />
        </MenuDialogHeader>
        <MenuDialogBody>
          <InputField
            label="Project name"
            defaultValue="insforge-prod"
            showIcon={false}
            showDropdown={false}
            showTip={false}
          />
          <InputField
            label="Project URL"
            defaultValue="https://insforge-prod.us.insforge.app"
            showIcon={false}
            showDropdown={false}
            showTip={false}
            disabled
          />
        </MenuDialogBody>
        <MenuDialogFooter>
          <Button variant="secondary" size="lg">
            Cancel
          </Button>
          <Button size="lg">Save changes</Button>
        </MenuDialogFooter>
      </MenuDialogMain>
    </MenuDialogContent>
  </MenuDialog>
);

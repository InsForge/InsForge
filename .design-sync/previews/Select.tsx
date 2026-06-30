import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectGroup,
} from '@insforge/ui';

// Open listbox (overlay). cfg.overrides.Select pins single + viewport.
export const Open = () => (
  <div style={{ padding: 24, width: 280 }}>
    <Select defaultValue="prod" open>
      <SelectTrigger>
        <SelectValue placeholder="Select environment" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Environments</SelectLabel>
          <SelectItem value="prod">Production</SelectItem>
          <SelectItem value="staging">Staging</SelectItem>
          <SelectItem value="dev">Development</SelectItem>
          <SelectItem value="preview" disabled>
            Preview (upgrade)
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  </div>
);

// The closed trigger on its own — the resting state.
export const Trigger = () => (
  <div style={{ padding: 24, width: 280 }}>
    <Select defaultValue="prod">
      <SelectTrigger>
        <SelectValue placeholder="Select environment" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="prod">Production</SelectItem>
        <SelectItem value="staging">Staging</SelectItem>
        <SelectItem value="dev">Development</SelectItem>
      </SelectContent>
    </Select>
  </div>
);

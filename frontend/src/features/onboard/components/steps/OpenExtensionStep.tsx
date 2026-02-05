import step2Image from '@/assets/images/vsc_ext_step2.png';

export function OpenExtensionStep() {
  return (
    <div className="flex flex-col gap-2">
      <p className="dark:text-neutral-400 text-gray-500 text-sm leading-6">
        Open InsForge extension and hover to the project you want to install the MCP server, then
        click on <span className="font-medium dark:text-white text-black">Install MCP</span>
      </p>
      <div className="w-full h-[320px] overflow-hidden rounded bg-neutral-800">
        <img
          src={step2Image}
          alt="InsForge extension showing Install MCP button"
          className="w-full h-full object-cover object-left-top border border-white/20 rounded-tl-xl"
        />
      </div>
    </div>
  );
}

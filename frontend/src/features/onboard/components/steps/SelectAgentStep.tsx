import step3Image from '@/assets/images/vsc_ext_step3.png';

export function SelectAgentStep() {
  return (
    <div className="flex flex-col gap-2">
      <p className="dark:text-neutral-400 text-gray-500 text-sm leading-6">
        Select the AI coding agent you want to connect with InsForge.
      </p>
      <div className="w-full h-[320px] overflow-hidden rounded bg-neutral-800">
        <img
          src={step3Image}
          alt="InsForge extension showing agent selection"
          className="w-full h-full object-cover object-left-top border border-white/20 rounded-tl-xl"
        />
      </div>
    </div>
  );
}

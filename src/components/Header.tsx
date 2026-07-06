import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import UpdaterModal from "@/components/common/UpdaterModal";
import ThemeToggle from "@/components/ThemeToggle";
import { useI18n } from "@/i18n";
import logo from "@/assets/logo.png";

export default function Header() {
  const { locale, setLocale, locales } = useI18n();

  return (
    <header className="border-border flex items-center justify-between border-b px-6 py-4">
      <div className="flex items-center gap-3">
        <img
          src={logo}
          alt="Backupper"
          className="size-9 rounded-lg object-contain"
        />
        <h1 className="text-xl font-semibold">Backupper</h1>
      </div>

      <div className="flex items-center gap-2">
        <UpdaterModal />
        <ThemeToggle />
        <Select value={locale} onValueChange={setLocale}>
          <SelectTrigger
            size="sm"
            aria-label="Language"
            data-testid="language-select"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {locales.map((l) => (
              <SelectItem key={l} value={l}>
                {l.toUpperCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </header>
  );
}

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2 } from "lucide-react";

export default function DankePage() {
  return (
    <Card className="text-center">
      <CardHeader>
        <div className="mx-auto mb-2">
          <CheckCircle2 className="h-12 w-12 text-success" />
        </div>
        <CardTitle>Vielen Dank!</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Deine Daten sind bei uns angekommen. Wir melden uns in Kürze mit den
          nächsten Schritten.
        </p>
      </CardContent>
    </Card>
  );
}

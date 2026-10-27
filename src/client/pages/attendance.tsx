import { useSearchParams } from "react-router";
import { Link } from "react-router";
import { useAuth } from "../lib/auth";
import { currentMonth } from "../lib/format";
import { PageHeader } from "../components/ui";
import { AttendanceMonth } from "../components/AttendanceMonth";

export function MyAttendancePage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const month = params.get("month") ?? currentMonth(me?.company?.closingDay ?? 0);
  return (
    <div>
      <PageHeader
        title="勤怠"
        sub="日ごとの打刻と労働時間です。打刻の誤りは「修正申請」から上長に申請できます。"
        actions={
          <>
            <Link to="/leave" className="btn btn-secondary">休暇を申請</Link>
            <Link to="/requests/new?kind=overtime" className="btn btn-secondary">残業を申請</Link>
          </>
        }
      />
      <AttendanceMonth month={month} onMonthChange={(m) => setParams({ month: m })} mode="self" />
    </div>
  );
}

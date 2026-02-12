<?php

namespace Tests\Icinga\Module\Perfdatagraphs;

use Icinga\Module\Perfdatagraphs\Widget\QuickActions;
use ipl\Web\Url;

use PHPUnit\Framework\TestCase;

final class QuickActionsTest extends TestCase
{
    public function test_assemble()
    {
        $qa = new QuickActions(Url::fromPath('/monitoring/host/show'));
        $rendered = $qa->render();

        $this->assertStringContainsString('class="quick-actions"', $rendered);
        $this->assertStringContainsString('perfdatagraphs.duration=', $rendered);
    }
}
